import Link from "next/link";

interface GoogleReauthRequiredProps {
  message?: string;
}

export default function GoogleReauthRequired({
  message = "Your Google authentication has expired.",
}: GoogleReauthRequiredProps) {
  return (
    <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
      <h3 className="font-medium text-sm mb-2 text-yellow-900">
        Re-authentication Required
      </h3>
      <p className="text-xs text-yellow-800 mb-3">{message}</p>
      <Link
        href="/integrations"
        className="inline-flex items-center gap-2 rounded-md bg-yellow-600 px-3 py-2 text-xs font-medium text-white hover:bg-yellow-700"
      >
        Go to Integrations to Reconnect
      </Link>
    </div>
  );
}
