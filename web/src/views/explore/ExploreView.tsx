import { useEffect, useMemo, useRef, useState } from "react";
import { isDesktop, isIOS, isMobileOnly, isSafari } from "react-device-detect";
import useSWR from "swr";
import { useApiHost } from "@/api";
import { cn } from "@/lib/utils";
import { BsArrowRightCircle } from "react-icons/bs";
import { useNavigate } from "react-router-dom";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TooltipPortal } from "@radix-ui/react-tooltip";
import { EventType, SearchResult } from "@/types/search";
import ImageLoadingIndicator from "@/components/indicators/ImageLoadingIndicator";
import useImageLoaded from "@/hooks/use-image-loaded";
import ActivityIndicator from "@/components/indicators/activity-indicator";
import { useTrackedObjectUpdate } from "@/api/ws";
import TimeAgo from "@/components/dynamic/TimeAgo";
import SearchResultActions from "@/components/menu/SearchResultActions";
import { SearchTab } from "@/components/overlay/detail/SearchDetailDialog";
import { FrigateConfig } from "@/types/frigateConfig";
import { useTranslation } from "react-i18next";
import { getTranslatedLabel } from "@/utils/i18n";
import { LuSearchX } from "react-icons/lu";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";
import axios from "axios";

type ExploreViewProps = {
  setSearchDetail: (search: SearchResult | undefined) => void;
  setSimilaritySearch: (search: SearchResult) => void;
  onSelectSearch: (item: SearchResult, ctrl: boolean, page?: SearchTab) => void;
};

export default function ExploreView({
  setSearchDetail,
  setSimilaritySearch,
  onSelectSearch,
}: ExploreViewProps) {
  const { t } = useTranslation(["views/explore"]);
  // title

  useEffect(() => {
    document.title = t("documentTitle");
  }, [t]);

  // semantic search state
  const [semanticQuery, setSemanticQuery] = useState("");
  const [semanticResults, setSemanticResults] = useState<SearchResult[]>([]);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSemanticSearch = async () => {
    const q = semanticQuery.trim();
    if (!q) return;
    setSemanticLoading(true);
    try {
      const resp = await axios.get<SearchResult[]>("search/semantic", {
        params: { query: q, limit: 20 },
      });
      setSemanticResults(resp.data ?? []);
    } catch {
      setSemanticResults([]);
    } finally {
      setSemanticLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSemanticSearch();
    }
  };

  // data

  const {
    data: events,
    mutate,
    isLoading,
    isValidating,
  } = useSWR<SearchResult[]>(
    [
      "events/explore",
      {
        limit: isMobileOnly ? 5 : 10,
      },
    ],
    {
      revalidateOnFocus: true,
    },
  );

  const eventsByLabel = useMemo(() => {
    if (!events) return {};
    return events.reduce<Record<string, SearchResult[]>>((acc, event) => {
      const label = event.label || "Unknown";
      if (!acc[label]) {
        acc[label] = [];
      }
      acc[label].push(event);
      return acc;
    }, {});
  }, [events]);

  const { payload: wsUpdate } = useTrackedObjectUpdate();

  useEffect(() => {
    if (wsUpdate && wsUpdate.type == "description") {
      mutate();
    }
  }, [wsUpdate, mutate]);

  if (isLoading) {
    return (
      <ActivityIndicator className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
    );
  }

  if (eventsByLabel && Object.keys(eventsByLabel).length == 0 && !isLoading) {
    return (
      <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center text-center">
        <LuSearchX className="size-16" />
        {t("noTrackedObjects")}
      </div>
    );
  }

  return (
    <div className="mx-2 space-y-4">
      {/* Semantic search input */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            className="pl-9"
            placeholder="Semantic search… (e.g. 'person with red shirt')"
            value={semanticQuery}
            onChange={(e) => setSemanticQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <Button
          variant="outline"
          onClick={handleSemanticSearch}
          disabled={semanticLoading || !semanticQuery.trim()}
        >
          {semanticLoading ? (
            <ActivityIndicator className="size-4" />
          ) : (
            "Search"
          )}
        </Button>
      </div>

      {/* Semantic search results */}
      {semanticQuery && !semanticLoading && semanticResults.length === 0 && (
        <div className="rounded-lg bg-background_alt p-3 text-center text-sm text-muted-foreground">
          No semantic results found for &ldquo;{semanticQuery}&rdquo;.
        </div>
      )}
      {semanticResults.length > 0 && (
        <div className="rounded-lg bg-background_alt p-2 md:px-4">
          <div className="mb-1 flex flex-row items-center text-sm font-semibold">
            Semantic Results
            <span className="ml-2 text-xs text-muted-foreground">
              ({semanticResults.length})
            </span>
          </div>
          <div className="flex flex-row flex-wrap gap-2 py-2">
            {semanticResults.map((event) => (
              <div
                key={event.id}
                className="relative aspect-square h-auto max-w-[20%] flex-grow md:max-w-[10%]"
              >
                <ExploreThumbnailImage
                  event={event}
                  setSearchDetail={setSearchDetail}
                  mutate={mutate}
                  setSimilaritySearch={setSimilaritySearch}
                  onSelectSearch={onSelectSearch}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {Object.entries(eventsByLabel).map(([label, filteredEvents]) => (
        <ThumbnailRow
          key={label}
          searchResults={filteredEvents}
          isValidating={isValidating}
          label={label}
          labelType={filteredEvents[0]?.data?.type || "object"}
          setSearchDetail={setSearchDetail}
          mutate={mutate}
          setSimilaritySearch={setSimilaritySearch}
          onSelectSearch={onSelectSearch}
        />
      ))}
    </div>
  );
}

type ThumbnailRowType = {
  label: string;
  labelType: EventType;
  searchResults?: SearchResult[];
  isValidating: boolean;
  setSearchDetail: (search: SearchResult | undefined) => void;
  mutate: () => void;
  setSimilaritySearch: (search: SearchResult) => void;
  onSelectSearch: (item: SearchResult, ctrl: boolean, page?: SearchTab) => void;
};

function ThumbnailRow({
  label,
  labelType,
  searchResults,
  isValidating,
  setSearchDetail,
  mutate,
  setSimilaritySearch,
  onSelectSearch,
}: ThumbnailRowType) {
  const { t } = useTranslation(["views/explore"]);
  const navigate = useNavigate();

  const handleSearch = (label: string) => {
    const similaritySearchParams = new URLSearchParams({
      labels: label,
    }).toString();
    navigate(`/explore?${similaritySearchParams}`);
  };

  return (
    <div className="rounded-lg bg-background_alt p-2 md:px-4">
      <div className="flex flex-row items-center text-lg smart-capitalize">
        {getTranslatedLabel(label, labelType)}
        {searchResults && (
          <span className="ml-3 text-sm text-secondary-foreground">
            {t("trackedObjectsCount", {
              // @ts-expect-error we know this is correct
              count: searchResults[0].event_count,
            })}
          </span>
        )}
        {isValidating && <ActivityIndicator className="ml-2 size-4" />}
      </div>
      <div className="flex flex-row items-center space-x-2 py-2">
        {searchResults?.map((event) => (
          <div
            key={event.id}
            className="relative aspect-square h-auto max-w-[20%] flex-grow md:max-w-[10%]"
          >
            <ExploreThumbnailImage
              event={event}
              setSearchDetail={setSearchDetail}
              mutate={mutate}
              setSimilaritySearch={setSimilaritySearch}
              onSelectSearch={onSelectSearch}
            />
          </div>
        ))}
        <div
          className="flex cursor-pointer items-center justify-center"
          onClick={() => handleSearch(label)}
        >
          <Tooltip>
            <TooltipTrigger>
              <BsArrowRightCircle
                className="ml-2 text-secondary-foreground transition-all duration-300 hover:text-primary"
                size={24}
              />
            </TooltipTrigger>
            <TooltipPortal>
              <TooltipContent>
                {t("exploreMore", {
                  label: getTranslatedLabel(label, labelType),
                })}
              </TooltipContent>
            </TooltipPortal>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

type ExploreThumbnailImageProps = {
  event: SearchResult;
  setSearchDetail: (search: SearchResult | undefined) => void;
  mutate: () => void;
  setSimilaritySearch: (search: SearchResult) => void;
  onSelectSearch: (item: SearchResult, ctrl: boolean, page?: SearchTab) => void;
};
function ExploreThumbnailImage({
  event,
  setSearchDetail,
  mutate,
  setSimilaritySearch,
  onSelectSearch,
}: ExploreThumbnailImageProps) {
  const apiHost = useApiHost();
  const { data: config } = useSWR<FrigateConfig>("config");
  const [imgRef, imgLoaded, onImgLoad] = useImageLoaded();
  const navigate = useNavigate();

  const handleFindSimilar = () => {
    if (config?.semantic_search.enabled) {
      setSimilaritySearch(event);
    }
  };

  const handleShowTrackingDetails = () => {
    onSelectSearch(event, false, "tracking_details");
  };

  const handleAddTrigger = () => {
    navigate(
      `/settings?page=triggers&camera=${event.camera}&event_id=${event.id}`,
    );
  };

  return (
    <SearchResultActions
      searchResult={event}
      findSimilar={handleFindSimilar}
      refreshResults={mutate}
      showTrackingDetails={handleShowTrackingDetails}
      addTrigger={handleAddTrigger}
      isContextMenu={true}
    >
      <div className="relative size-full">
        <ImageLoadingIndicator
          className="absolute inset-0"
          imgLoaded={imgLoaded}
        />
        <img
          ref={imgRef}
          className={cn(
            "absolute size-full cursor-pointer rounded-lg object-cover transition-all duration-300 ease-in-out lg:rounded-2xl",
            !imgLoaded && "invisible",
          )}
          style={
            isIOS
              ? {
                  WebkitUserSelect: "none",
                  WebkitTouchCallout: "none",
                }
              : undefined
          }
          loading={isSafari ? "eager" : "lazy"}
          draggable={false}
          src={`${apiHost}api/events/${event.id}/thumbnail.webp`}
          onClick={() => setSearchDetail(event)}
          onLoad={onImgLoad}
          alt={`${event.label} thumbnail`}
        />
        {isDesktop && (
          <div className="absolute bottom-1 right-1 z-10 rounded-lg bg-black/50 px-2 py-1 text-xs text-white">
            {event.end_time ? (
              <TimeAgo time={event.start_time * 1000} dense />
            ) : (
              <div>
                <ActivityIndicator size={10} />
              </div>
            )}
          </div>
        )}
      </div>
    </SearchResultActions>
  );
}
