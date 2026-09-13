import { Link } from "react-router-dom";

import { formatCompact } from "../lib/money";
import type { ProjectSummary } from "../lib/types";
import { Chip, Money, ProgressBar, cx } from "./ui";

function statusChip(project: ProjectSummary) {
  if (project.alert === "critical") {
    return (
      <Chip tone="neg">Short {formatCompact(Math.abs(project.in_hand))}</Chip>
    );
  }
  if (project.alert === "warning") {
    return <Chip tone="warn">{Math.round(project.percent_of_received)}% spent</Chip>;
  }
  if (project.status === "completed") return <Chip tone="neutral">Completed</Chip>;
  if (project.status === "on_hold") return <Chip tone="neutral">On hold</Chip>;
  return <Chip tone="pos">On track</Chip>;
}

export default function ProjectCard({ project }: { project: ProjectSummary }) {
  const tone =
    project.alert === "critical"
      ? "neg"
      : project.alert === "warning"
        ? "warn"
        : "accent";

  const meta = [project.client_name, project.location, project.project_type]
    .filter(Boolean)
    .join(" · ");

  return (
    <Link
      to={`/projects/${project.project_id}`}
      className={cx(
        "card block p-4 transition-shadow hover:shadow-card focus-visible:shadow-card",
        project.alert === "critical" && "border-neg/40",
      )}
    >
      <div className="mb-3.5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold leading-tight tracking-tight">
            {project.name}
          </div>
          <div className="label mt-1 truncate normal-case tracking-normal">
            {meta}
          </div>
        </div>
        {statusChip(project)}
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2">
        <div>
          <div className="label">Received</div>
          <Money paise={project.received} compact className="text-[14px] font-medium" />
        </div>
        <div>
          <div className="label">Spent</div>
          <Money paise={project.spent} compact className="text-[14px] font-medium" />
        </div>
        <div>
          <div className="label">In hand</div>
          <Money paise={project.in_hand} compact className="text-[14px] font-medium" />
        </div>
      </div>

      <ProgressBar percent={project.percent_of_received} tone={tone} height={7} />

      <div className="mt-2 flex items-baseline justify-between gap-2 text-2xs text-ink-3">
        <span className="tabular">
          {Math.round(project.percent_of_received)}% of received
        </span>
        <span className="truncate text-right">
          {project.alert === "critical"
            ? "Funded from another fund"
            : project.budget > 0
              ? `Budget ${formatCompact(project.budget)}`
              : "No budget set"}
        </span>
      </div>

      {/* A drawn fee is why "in hand" can be less than received minus spent.
          Saying so on the card stops it reading as missing money. */}
      {project.drawn > 0 && (
        <div className="mt-2 border-t border-line-soft pt-2 text-2xs text-ink-3">
          <span className="tabular">{formatCompact(project.drawn)}</span> fee drawn
          to Personal
        </div>
      )}
    </Link>
  );
}
