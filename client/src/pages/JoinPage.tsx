import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useClerk } from "@clerk/clerk-react";
import { Loader2, CheckCircle, XCircle, Mail, Building2, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

interface InviteDetails {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  companyName: string;
  roleName: string | null;
  invitedAt: string | null;
  inviteCount: number | null;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days !== 1 ? "s" : ""} ago`;
}

export default function JoinPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [, navigate] = useLocation();
  const { openSignUp } = useClerk();

  const { data: invite, isLoading, error } = useQuery<InviteDetails>({
    queryKey: ["/api/invite", token],
    queryFn: async () => {
      const res = await fetch(`/api/invite/${token}`);
      if (res.status === 410) throw new Error("already_accepted");
      if (!res.ok) throw new Error("not_found");
      return res.json();
    },
    retry: false,
    enabled: !!token,
  });

  const handleAccept = () => {
    openSignUp({
      initialValues: invite?.email ? { emailAddress: invite.email } : undefined,
      redirectUrl: "/",
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-violet-50 to-indigo-50 flex items-center justify-center">
        <div className="text-center space-y-3">
          <Loader2 className="h-10 w-10 animate-spin text-violet-500 mx-auto" />
          <p className="text-muted-foreground text-sm">Loading your invitation...</p>
        </div>
      </div>
    );
  }

  if (error) {
    const alreadyAccepted = (error as Error).message === "already_accepted";
    return (
      <div className="min-h-screen bg-gradient-to-br from-violet-50 to-indigo-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md text-center">
          <div className="bg-white rounded-2xl shadow-lg shadow-violet-100 p-8 space-y-4">
            {alreadyAccepted ? (
              <>
                <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                  <CheckCircle className="h-7 w-7 text-green-600" />
                </div>
                <h2 className="text-xl font-bold text-gray-900">Invite Already Accepted</h2>
                <p className="text-muted-foreground text-sm">
                  This invitation has already been used. If you have an account, sign in to continue.
                </p>
                <Button
                  className="w-full bg-violet-600 hover:bg-violet-700"
                  onClick={() => navigate("/")}
                >
                  Go to Taime
                </Button>
              </>
            ) : (
              <>
                <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                  <XCircle className="h-7 w-7 text-red-500" />
                </div>
                <h2 className="text-xl font-bold text-gray-900">Invitation Not Found</h2>
                <p className="text-muted-foreground text-sm">
                  This invitation link is invalid or has expired. Please ask your manager to send a new invite.
                </p>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => navigate("/")}
                >
                  Go to Taime
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!invite) return null;

  const firstName = invite.firstName || invite.email?.split("@")[0] || "there";
  const fullName = [invite.firstName, invite.lastName].filter(Boolean).join(" ") || invite.email || "";

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 via-indigo-50 to-white flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-white rounded-2xl px-5 py-3 shadow-md shadow-violet-100 mb-3">
            <img src="/TAIME-logo.png" alt="Taime" className="h-8 w-auto" />
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-xl shadow-violet-100 overflow-hidden">

          <div className="bg-gradient-to-r from-violet-600 to-indigo-500 px-8 py-8 text-center">
            <div className="w-16 h-16 bg-white/20 backdrop-blur rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl font-bold text-white">
                {(invite.firstName || invite.email || "?")[0].toUpperCase()}
              </span>
            </div>
            <h1 className="text-2xl font-bold text-white mb-1">
              Welcome, {firstName}!
            </h1>
            <p className="text-violet-100 text-sm">
              You've been invited to join a team
            </p>
          </div>

          <div className="px-8 py-7 space-y-5">

            <div className="flex items-center gap-3 bg-violet-50 rounded-xl px-4 py-3.5">
              <Building2 className="h-5 w-5 text-violet-500 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Company</p>
                <p className="text-sm font-semibold text-gray-900">{invite.companyName}</p>
              </div>
            </div>

            {invite.email && (
              <div className="flex items-center gap-3 bg-violet-50 rounded-xl px-4 py-3.5">
                <Mail className="h-5 w-5 text-violet-500 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Invited email</p>
                  <p className="text-sm font-semibold text-gray-900">{invite.email}</p>
                </div>
              </div>
            )}

            {invite.roleName && (
              <div className="flex items-center gap-3 bg-violet-50 rounded-xl px-4 py-3.5">
                <UserCheck className="h-5 w-5 text-violet-500 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Your role</p>
                  <p className="text-sm font-semibold text-gray-900">{invite.roleName}</p>
                </div>
              </div>
            )}

            <div className="space-y-2 pt-1">
              <p className="text-xs text-center text-muted-foreground">
                Sign up using <strong>{invite.email}</strong> to join your team
              </p>
              <Button
                className="w-full h-12 text-base font-semibold bg-gradient-to-r from-violet-600 to-indigo-500 hover:from-violet-700 hover:to-indigo-600 shadow-lg shadow-violet-200"
                onClick={handleAccept}
              >
                Accept Invitation & Create Account
              </Button>
              <Button
                variant="ghost"
                className="w-full text-muted-foreground hover:text-gray-900"
                onClick={() => navigate("/")}
              >
                I already have an account
              </Button>
            </div>

          </div>
        </div>

        <div className="mt-6 text-center space-y-1">
          <p className="text-xs text-muted-foreground">
            {invite.invitedAt && `Sent ${timeAgo(invite.invitedAt)}`}
            {(invite.inviteCount || 0) > 1 && ` · Resent ${invite.inviteCount! - 1} time${invite.inviteCount! > 2 ? "s" : ""}`}
          </p>
          <p className="text-xs text-muted-foreground">
            Questions? Contact your manager directly.
          </p>
        </div>
      </div>
    </div>
  );
}
