"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  BarChart as RCBarChart,
  AreaChart as RCAreaChart,
  Area,
  Bar,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type MetricsResponse = {
  ok: boolean;
  rangeDays: number;
  summary: {
    briefsGenerated: number;
    activeBriefUsers: number;
    feedbackUpRate: number;
    jobsBacklog: number;
  };
  jobs: {
    backlog: { pending: number; maxAgeMinutes: number };
  };
  briefs: {
    perDay: { day: string; meetingType: string; briefs: number }[];
    feedback: { up: number; down: number; other: number };
    read: { read: number; total: number; avgMinutesToRead: number };
    coverage: { meetings: number; briefs: number };
  };
  schedules: {
    activeUsers: number;
    byType: { type: string; count: number }[];
  };
  sync: {
    totalUsers: number;
    staleUsers: number;
    jobsByStatus: { status: string; count: number }[];
  };
  actionItems: {
    created: number;
    resolved: number;
    withDue: number;
    withoutDue: number;
    overdue: number;
  };
};

const rangeOptions = [
  { label: "Last 7 days", value: 7 },
  { label: "Last 30 days", value: 30 },
  { label: "Last 90 days", value: 90 },
];

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  return `${Math.round(value * 100)}%`;
}

function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

const palette = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];
const chartGrid = "var(--border)";
const chartText = "var(--foreground)";
const chartMuted = "var(--muted-foreground)";
function colorAt(index: number): string {
  return palette[index % palette.length];
}

type BasicProps = { children: React.ReactNode; className?: string };

function Card({ children, className = "" }: BasicProps) {
  return (
    <div
      className={`rounded-lg border border-border bg-card p-4 shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

function Title({ children, className = "" }: BasicProps) {
  return <h2 className={`text-lg font-semibold ${className}`}>{children}</h2>;
}

function Text({ children, className = "" }: BasicProps) {
  return <p className={`text-sm text-foreground ${className}`}>{children}</p>;
}

function Badge({
  children,
  color = "gray",
  className = "",
}: BasicProps & { color?: "gray" | "orange" }) {
  const isWarning = color === "orange";
  const styles = isWarning
    ? "border"
    : "bg-muted text-foreground border border-border";
  const warningTone = isWarning
    ? {
        backgroundColor: "hsl(38 92% 50% / 0.12)",
        color: "hsl(38 92% 50%)",
        borderColor: "hsl(38 92% 50% / 0.24)",
      }
    : undefined;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${styles} ${className}`}
      style={warningTone}
    >
      {children}
    </span>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color?: string }>;
  label?: string | number;
}) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 shadow-sm">
      <div className="text-xs font-medium text-foreground">{label}</div>
      <div className="mt-1 space-y-1 text-xs">
        {payload.map((entry) => (
          <div
            key={entry.dataKey}
            className="flex items-center justify-between gap-3"
          >
            <span className="flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-sm"
                style={{
                  backgroundColor: entry.color || "var(--color-chart-1)",
                }}
              />
              {entry.dataKey}
            </span>
            <span className="font-semibold">
              {formatNumber(entry.value ?? 0)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-4 py-3 md:px-6 md:py-4">
      <span className="text-xs font-medium uppercase tracking-wide">
        {label}
      </span>
      <span className="text-3xl font-semibold leading-tight md:text-4xl">
        {value}
      </span>
      {sub ? <span className="text-xs md:text-sm">{sub}</span> : null}
    </div>
  );
}

export default function AdminDashboard() {
  const [range, setRange] = useState<number>(30);
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/metrics/overview?range=${range}`);
        const json: MetricsResponse = await res.json();
        if (!isMounted) return;
        if (!json.ok) {
          setError("Failed to load metrics");
          setLoading(false);
          return;
        }
        setData(json);
      } catch {
        if (!isMounted) return;
        setError("Failed to load metrics");
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    void load();
    return () => {
      isMounted = false;
    };
  }, [range]);

  const meetingTypes = useMemo(() => {
    const types = new Set<string>();
    data?.briefs.perDay.forEach((row) => types.add(row.meetingType));
    return Array.from(types);
  }, [data]);

  const briefsPerDayChart = useMemo(() => {
    const map = new Map<string, Record<string, number | string>>();
    data?.briefs.perDay.forEach((row) => {
      const label = format(new Date(row.day), "MMM d");
      if (!map.has(label)) {
        map.set(label, { day: label });
      }
      const entry = map.get(label)!;
      entry[row.meetingType] =
        ((entry[row.meetingType] as number) || 0) + row.briefs;
    });
    return Array.from(map.values());
  }, [data]);

  const feedbackBarData = useMemo(() => {
    if (!data) return [];
    return [
      {
        label: "Feedback",
        Up: data.briefs.feedback.up,
        Down: data.briefs.feedback.down,
      },
    ];
  }, [data]);

  const scheduleDonutData = useMemo(() => {
    return (
      data?.schedules.byType.map((row, idx) => ({
        name: row.type,
        value: row.count,
        color: colorAt(idx),
      })) ?? []
    );
  }, [data]);

  const loadingState = (
    <div className="space-y-4">
      <div className="h-10 w-48 rounded bg-border animate-pulse" />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, idx) => (
          <Card key={idx} className="h-32 animate-pulse bg-border/40">
            <div className="h-full w-full" />
          </Card>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="h-72 animate-pulse bg-border/40">
          <div className="h-full w-full" />
        </Card>
        <Card className="h-72 animate-pulse bg-border/40">
          <div className="h-full w-full" />
        </Card>
      </div>
      <Card className="h-72 animate-pulse bg-border/40">
        <div className="h-full w-full" />
      </Card>
    </div>
  );

  if (loading) return loadingState;
  if (error || !data) {
    return (
      <Card className="border-destructive border bg-destructive/5 text-destructive">
        <Title>Metrics unavailable</Title>
        <Text>{error ?? "Unable to fetch data."}</Text>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <Title className="text-xl font-semibold">Admin Dashboard</Title>
          <Text className="text-muted-foreground">
            Usage, reliability, and feedback at a glance.
          </Text>
        </div>
        <div className="flex items-center gap-3">
          <Text className="text-sm text-muted-foreground">Range</Text>
          <select
            className="rounded-md border border-border bg-card px-3 py-2 text-sm"
            value={range}
            onChange={(e) => setRange(parseInt(e.target.value, 10))}
          >
            {rangeOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <Title className="text-lg font-semibold">Briefs</Title>
        <div className="mt-3 rounded-2xl ring-1">
          <div className="grid gap-0 divide-x md:grid-cols-4 bg-card rounded-2xl">
            <StatCard
              label="Briefs generated"
              value={formatNumber(data.summary.briefsGenerated)}
              sub={`${range} day window`}
            />
            <StatCard
              label="Active brief users (7d)"
              value={formatNumber(data.summary.activeBriefUsers)}
              sub="Users who saw any brief"
            />
            <StatCard
              label="Feedback up rate"
              value={formatPercent(data.summary.feedbackUpRate)}
              sub={`${formatNumber(data.briefs.feedback.up + data.briefs.feedback.down)} total votes`}
            />
            <StatCard
              label="Read rate"
              value={
                data.briefs.read.total === 0
                  ? "0%"
                  : formatPercent(
                      data.briefs.read.read / data.briefs.read.total,
                    )
              }
              sub={`Briefs read`}
            />
          </div>
        </div>
      </div>

      <div>
        <Title className="text-lg font-semibold">Action items</Title>
        <div className="mt-3 rounded-2xl shadow-lg ring-1">
          <div className="grid gap-0 divide-x md:grid-cols-5 bg-card rounded-2xl">
            <StatCard
              label="Created"
              value={formatNumber(data.actionItems.created)}
              sub={`${range} day window`}
            />
            <StatCard
              label="Resolved"
              value={formatNumber(data.actionItems.resolved)}
              sub={`${range} day window`}
            />
            <StatCard
              label="Overdue"
              value={formatNumber(data.actionItems.overdue)}
              sub="Due date passed"
            />
            <StatCard
              label="With due date"
              value={formatNumber(data.actionItems.withDue)}
              sub="All time"
            />
            <StatCard
              label="Without due date"
              value={formatNumber(data.actionItems.withoutDue)}
              sub="All time"
            />
          </div>
        </div>
      </div>

      <div>
        <Title className="text-lg font-semibold">Other Metrics</Title>
        <div className="mt-3 rounded-xl shadow-lg ring-1">
          <div className="grid gap-0 divide-x md:grid-cols-5 bg-card rounded-2xl">
            <StatCard
              label="Total Users"
              value={formatNumber(data.sync.totalUsers)}
              sub={`Users in the system`}
            />
            <StatCard
              label="Stale Users"
              value={formatNumber(data.sync.staleUsers)}
              sub="Calendar sync &gt; 24 hrs"
            />
            <StatCard
              label="Coverage (7d)"
              value={`${formatNumber(data.briefs.coverage.briefs)}/
                ${formatNumber(data.briefs.coverage.meetings)}`}
              sub={`Briefs`}
            />
            <StatCard
              label="Jobs backlog"
              value={formatNumber(data.jobs.backlog.pending)}
              sub={`Max age ${Math.round(data.jobs.backlog.maxAgeMinutes)}m`}
            />

            <StatCard
              label="Avg time to read"
              value={formatNumber(
                Math.round(data.briefs.read.avgMinutesToRead),
              )}
              sub={`minutes`}
            />
          </div>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="rounded-2xl">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <Title>Brief volume by day</Title>
            </div>
            {briefsPerDayChart.length === 0 && (
              <Badge color="gray">No data</Badge>
            )}
          </div>
          <div className="mt-2 h-64">
            <ResponsiveContainer>
              <RCAreaChart data={briefsPerDayChart}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                <XAxis dataKey="day" tick={{ fill: chartMuted }} />
                <YAxis
                  tickFormatter={(v) => formatNumber(v as number)}
                  tick={{ fill: chartMuted }}
                />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ color: chartText }} />
                {meetingTypes.map((mt, idx) => (
                  <Area
                    key={mt}
                    type="monotone"
                    dataKey={mt}
                    stackId="1"
                    stroke={colorAt(idx)}
                    fill={colorAt(idx)}
                    fillOpacity={0.35}
                    connectNulls
                  />
                ))}
              </RCAreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="rounded-2xl">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <Title>Calendar sync health</Title>
            </div>
            {data.sync.jobsByStatus.length === 0 && (
              <Badge color="gray">No data</Badge>
            )}
          </div>
          <div className="h-64">
            <ResponsiveContainer>
              <RCBarChart data={data.sync.jobsByStatus}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                <XAxis dataKey="status" tick={{ fill: chartMuted }} />
                <YAxis allowDecimals={false} tick={{ fill: chartMuted }} />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ color: chartText }} />
                <Bar
                  dataKey="count"
                  fill="var(--chart-1)"
                  barSize={32}
                  radius={[4, 4, 0, 0]}
                />
              </RCBarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="rounded-2xl">
          <Title>Feedback mix</Title>
          <div className="h-56">
            <ResponsiveContainer>
              <RCBarChart data={feedbackBarData}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                <XAxis dataKey="label" tick={{ fill: chartMuted }} />
                <YAxis allowDecimals={false} tick={{ fill: chartMuted }} />
                <Tooltip
                  content={<ChartTooltip />}
                  wrapperStyle={{ outline: "none" }}
                />
                <Legend wrapperStyle={{ color: chartText }} />
                <Bar dataKey="Up" fill="var(--success)" barSize={24} />
                <Bar dataKey="Down" fill="var(--destructive)" barSize={24} />
              </RCBarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="rounded-2xl">
          <Title>Schedule coverage</Title>
          <div className="mt-2 h-56">
            {scheduleDonutData.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No schedule data
              </div>
            ) : (
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={scheduleDonutData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius="60%"
                    outerRadius="90%"
                  >
                    {scheduleDonutData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ color: chartText }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
          <Text className="mt-2 text-sm text-muted-foreground">
            {formatNumber(data.schedules.activeUsers)} users with an active
            schedule
          </Text>
        </Card>
      </div>
    </div>
  );
}
