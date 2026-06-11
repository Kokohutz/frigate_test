import { useCallback, useState } from "react";
import useSWR from "swr";
import axios from "axios";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Heading from "@/components/ui/heading";
import ActivityIndicator from "@/components/indicators/activity-indicator";
import { Fingerprint, Plus, Trash2 } from "lucide-react";

type PasskeyCredential = {
  id: string;
  name: string;
  created_at: string;
  last_used?: string;
};

function formatDate(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Convert base64url to Uint8Array
function base64urlToUint8Array(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  return new Uint8Array(binary.length).map((_, i) => binary.charCodeAt(i));
}

// Convert ArrayBuffer to base64url
function arrayBufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export default function WebAuthnSettings() {
  const { data: credentials, mutate, isLoading } =
    useSWR<PasskeyCredential[]>("auth/webauthn/credentials");
  const [enrolling, setEnrolling] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const isSupported = typeof window !== "undefined" && !!window.PublicKeyCredential;

  const handleEnroll = useCallback(async () => {
    if (!isSupported) return;
    setEnrolling(true);
    try {
      // Step 1: Begin registration
      const beginResp = await axios.post<{
        challenge: string;
        rp: { name: string; id?: string };
        user: { id: string; name: string; displayName: string };
        pubKeyCredParams: { alg: number; type: string }[];
        timeout?: number;
        excludeCredentials?: { id: string; type: string }[];
        authenticatorSelection?: {
          authenticatorAttachment?: string;
          residentKey?: string;
          requireResidentKey?: boolean;
          userVerification?: string;
        };
        attestation?: string;
      }>("auth/webauthn/register/begin");

      const opts = beginResp.data;

      // Build PublicKeyCredentialCreationOptions
      const createOptions: PublicKeyCredentialCreationOptions = {
        challenge: base64urlToUint8Array(opts.challenge).buffer as ArrayBuffer,
        rp: { name: opts.rp.name, id: opts.rp.id },
        user: {
          id: base64urlToUint8Array(opts.user.id).buffer as ArrayBuffer,
          name: opts.user.name,
          displayName: opts.user.displayName,
        },
        pubKeyCredParams: opts.pubKeyCredParams.map((p) => ({
          alg: p.alg,
          type: p.type as PublicKeyCredentialType,
        })),
        timeout: opts.timeout ?? 60000,
        excludeCredentials: opts.excludeCredentials?.map((c) => ({
          id: base64urlToUint8Array(c.id).buffer as ArrayBuffer,
          type: c.type as PublicKeyCredentialType,
        })),
        authenticatorSelection: opts.authenticatorSelection
          ? {
              authenticatorAttachment: opts.authenticatorSelection
                .authenticatorAttachment as AuthenticatorAttachment | undefined,
              residentKey: opts.authenticatorSelection
                .residentKey as ResidentKeyRequirement | undefined,
              requireResidentKey:
                opts.authenticatorSelection.requireResidentKey,
              userVerification: opts.authenticatorSelection
                .userVerification as UserVerificationRequirement | undefined,
            }
          : undefined,
        attestation: (opts.attestation as AttestationConveyancePreference) ?? "none",
      };

      // Step 2: Call WebAuthn API
      const credential = (await navigator.credentials.create({
        publicKey: createOptions,
      })) as PublicKeyCredential | null;

      if (!credential) {
        toast.error("Passkey creation cancelled", { position: "top-center" });
        return;
      }

      const response = credential.response as AuthenticatorAttestationResponse;

      // Step 3: Complete registration
      await axios.post("auth/webauthn/register/complete", {
        id: credential.id,
        rawId: arrayBufferToBase64url(credential.rawId),
        type: credential.type,
        response: {
          clientDataJSON: arrayBufferToBase64url(response.clientDataJSON),
          attestationObject: arrayBufferToBase64url(response.attestationObject),
        },
      });

      await mutate();
      toast.success("Passkey registered successfully", {
        position: "top-center",
      });
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        toast.error("Passkey creation was cancelled", {
          position: "top-center",
        });
      } else {
        const msg =
          (err as { response?: { data?: { message?: string } } })?.response
            ?.data?.message ?? "Unknown error";
        toast.error(`Failed to register passkey: ${msg}`, {
          position: "top-center",
        });
      }
    } finally {
      setEnrolling(false);
    }
  }, [isSupported, mutate]);

  const handleDelete = useCallback(
    async (id: string) => {
      setDeleting(id);
      try {
        await axios.delete(`auth/webauthn/credentials/${id}`);
        await mutate();
        toast.success("Passkey removed", { position: "top-center" });
      } catch {
        toast.error("Failed to remove passkey", { position: "top-center" });
      } finally {
        setDeleting(null);
      }
    },
    [mutate],
  );

  if (!isSupported) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <div className="flex items-center gap-3">
          <Fingerprint className="size-8 text-muted-foreground" />
          <div>
            <p className="font-medium">WebAuthn Not Supported</p>
            <p className="text-sm text-muted-foreground">
              Your browser does not support WebAuthn / Passkeys. Please use a
              modern browser such as Chrome, Firefox, Safari, or Edge.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Heading as="h4" className="mb-1">
            Passkeys (WebAuthn)
          </Heading>
          <p className="text-sm text-muted-foreground">
            Register hardware security keys or biometric authenticators for
            password-free login.
          </p>
        </div>
        <Button
          className="flex items-center gap-2"
          onClick={handleEnroll}
          disabled={enrolling}
        >
          {enrolling ? (
            <ActivityIndicator className="size-4" />
          ) : (
            <Plus className="size-4" />
          )}
          {enrolling ? "Registering…" : "Add Passkey"}
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-6">
          <ActivityIndicator />
        </div>
      ) : credentials && credentials.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Registered</TableHead>
                <TableHead>Last Used</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {credentials.map((cred) => (
                <TableRow key={cred.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Fingerprint className="size-4 text-primary" />
                      <span className="font-medium">
                        {cred.name || "Unnamed passkey"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(cred.created_at)}
                  </TableCell>
                  <TableCell>
                    {cred.last_used ? (
                      <span className="text-sm text-muted-foreground">
                        {formatDate(cred.last_used)}
                      </span>
                    ) : (
                      <Badge
                        variant="outline"
                        className="text-xs text-muted-foreground"
                      >
                        Never used
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-8 px-2"
                      onClick={() => handleDelete(cred.id)}
                      disabled={deleting === cred.id}
                    >
                      {deleting === cred.id ? (
                        <ActivityIndicator className="size-3.5" />
                      ) : (
                        <Trash2 className="size-3.5" />
                      )}
                      <span className="ml-1.5 hidden sm:inline-block">
                        Remove
                      </span>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-10">
          <Fingerprint className="size-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No passkeys registered yet.
          </p>
          <Button variant="outline" onClick={handleEnroll} disabled={enrolling}>
            <Plus className="mr-2 size-4" />
            Register your first passkey
          </Button>
        </div>
      )}
    </div>
  );
}
