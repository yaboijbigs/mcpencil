import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { label?: string };

function IconShell({ label, children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      aria-label={label}
      {...props}
    >
      {children}
    </svg>
  );
}

export const PencilIcon = (props: IconProps) => (
  <IconShell {...props}>
    <path d="m4 20 4.2-1 10.6-10.6a2.25 2.25 0 0 0-3.2-3.2L5 15.8 4 20Z" />
    <path d="m14 6.8 3.2 3.2M5.3 15.7l3 3" />
  </IconShell>
);

export const SparkIcon = (props: IconProps) => (
  <IconShell {...props}>
    <path d="M12 3c.6 4.5 2.5 6.4 7 7-4.5.6-6.4 2.5-7 7-.6-4.5-2.5-6.4-7-7 4.5-.6 6.4-2.5 7-7Z" />
    <path d="M19 16c.2 1.6.9 2.3 2.5 2.5-1.6.2-2.3.9-2.5 2.5-.2-1.6-.9-2.3-2.5-2.5 1.6-.2 2.3-.9 2.5-2.5Z" />
  </IconShell>
);

export const PeopleIcon = (props: IconProps) => (
  <IconShell {...props}>
    <circle cx="9" cy="8" r="3" />
    <path d="M3.5 20v-2.2A4.8 4.8 0 0 1 8.3 13h1.4a4.8 4.8 0 0 1 4.8 4.8V20" />
    <path d="M15.5 5.6a3 3 0 0 1 0 5.8M17 13.4a4.8 4.8 0 0 1 3.5 4.6v2" />
  </IconShell>
);

export const BotIcon = (props: IconProps) => (
  <IconShell {...props}>
    <rect x="3.5" y="7" width="17" height="13" rx="4" />
    <path d="M12 3v4M9 3h6" />
    <circle cx="9" cy="13" r="1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="13" r="1" fill="currentColor" stroke="none" />
    <path d="M9 17h6" />
  </IconShell>
);

export const CopyIcon = (props: IconProps) => (
  <IconShell {...props}>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
  </IconShell>
);

export const CheckIcon = (props: IconProps) => (
  <IconShell {...props}>
    <path d="m5 12 4 4L19 6" />
  </IconShell>
);

export const PenToolIcon = (props: IconProps) => (
  <IconShell {...props}>
    <path d="m4 20 4-1 10-10-3-3L5 16l-1 4Z" />
  </IconShell>
);

export const LineIcon = (props: IconProps) => (
  <IconShell {...props}>
    <path d="M5 19 19 5" />
    <circle cx="5" cy="19" r="1.5" fill="currentColor" />
    <circle cx="19" cy="5" r="1.5" fill="currentColor" />
  </IconShell>
);

export const RectangleIcon = (props: IconProps) => (
  <IconShell {...props}>
    <rect x="4" y="5" width="16" height="14" rx="2" />
  </IconShell>
);

export const EllipseIcon = (props: IconProps) => (
  <IconShell {...props}>
    <ellipse cx="12" cy="12" rx="8" ry="6" />
  </IconShell>
);

export const EraserIcon = (props: IconProps) => (
  <IconShell {...props}>
    <path d="m4 15 8-9a2 2 0 0 1 3 0l4 4a2 2 0 0 1 0 3l-6 7H8l-4-3a1.5 1.5 0 0 1 0-2Z" />
    <path d="m10 9 7 7M13 20h7" />
  </IconShell>
);

export const UndoIcon = (props: IconProps) => (
  <IconShell {...props}>
    <path d="M9 7 4 12l5 5" />
    <path d="M5 12h9a6 6 0 0 1 6 6" />
  </IconShell>
);

export const EyeIcon = (props: IconProps) => (
  <IconShell {...props}>
    <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
    <circle cx="12" cy="12" r="2.5" />
  </IconShell>
);

export const ReplayIcon = (props: IconProps) => (
  <IconShell {...props}>
    <path d="M4 11a8 8 0 1 1 2 6" />
    <path d="M4 5v6h6" />
  </IconShell>
);

export const ArrowIcon = (props: IconProps) => (
  <IconShell {...props}>
    <path d="M5 12h14M14 7l5 5-5 5" />
  </IconShell>
);

export const ChevronIcon = (props: IconProps) => (
  <IconShell {...props}>
    <path d="m7 10 5 5 5-5" />
  </IconShell>
);

export const XIcon = (props: IconProps) => (
  <IconShell {...props}>
    <path d="m6 6 12 12M18 6 6 18" />
  </IconShell>
);

export const SoundIcon = (props: IconProps) => (
  <IconShell {...props}>
    <path d="M5 10v4h3l4 4V6L8 10H5Z" />
    <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />
  </IconShell>
);

export const InfoIcon = (props: IconProps) => (
  <IconShell {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </IconShell>
);
