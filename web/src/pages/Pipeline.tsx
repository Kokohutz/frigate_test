import { PipelineFlow } from "@/views/pipeline/PipelineFlow";
import { Toaster } from "sonner";

export default function Pipeline() {
  return (
    <div className="size-full">
      <Toaster closeButton richColors />
      <PipelineFlow />
    </div>
  );
}
