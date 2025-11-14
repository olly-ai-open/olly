"use client";

import dynamic from "next/dynamic";

interface ClientDateTimeProps {
  date: Date | string | null;
  fallback?: string;
  format?: Intl.DateTimeFormatOptions;
  prefix?: string;
}

// Dynamic import with no SSR - this component only renders on client
const ClientDateTimeImpl = dynamic(() => import("./client-date-time-impl"), {
  ssr: false,
  loading: () => <span>&nbsp;</span>,
});

export default function ClientDateTime(props: ClientDateTimeProps) {
  return <ClientDateTimeImpl {...props} />;
}
