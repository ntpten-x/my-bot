import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition disabled:pointer-events-none disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
  {
    variants: {
      variant: {
        default: "bg-accent text-on-accent hover:opacity-90",
        outline: "border border-line bg-card text-fg hover:bg-accent-soft",
        ghost: "text-fg hover:bg-accent-soft",
        pine: "bg-accent text-on-accent hover:opacity-90",
        danger: "border border-danger/40 bg-card text-danger hover:bg-danger/10",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-8 px-3 text-xs",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export function Input(props: React.ComponentProps<"input">) {
  return (
    <input
      {...props}
      className={cn(
        "h-10 w-full rounded-lg border border-line bg-card px-3 text-sm text-fg outline-none ring-accent focus:ring-2",
        props.className,
      )}
    />
  );
}

export function Textarea(props: React.ComponentProps<"textarea">) {
  return (
    <textarea
      {...props}
      className={cn(
        "min-h-24 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-fg outline-none ring-accent focus:ring-2",
        props.className,
      )}
    />
  );
}

export function Label(props: React.ComponentProps<"label">) {
  return <label {...props} className={cn("mb-1 block text-sm font-medium", props.className)} />;
}

export function Badge({
  className,
  tone = "neutral",
  ...props
}: React.ComponentProps<"span"> & { tone?: "neutral" | "pine" | "clay" | "amber" | "danger" }) {
  const tones = {
    neutral: "bg-accent-soft text-fg",
    pine: "bg-ok/15 text-ok",
    clay: "bg-accent-soft text-accent",
    amber: "bg-warn/20 text-warn",
    danger: "bg-danger/15 text-danger",
  };
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", tones[tone], className)} {...props} />
  );
}

export function Card({ className, ...props }: React.ComponentProps<"section">) {
  return <section className={cn("rounded-2xl border border-line bg-card p-4 shadow-sm", className)} {...props} />;
}

export function Select(props: React.ComponentProps<"select">) {
  return (
    <select
      {...props}
      className={cn(
        "h-10 w-full rounded-lg border border-line bg-card px-3 text-sm text-fg outline-none ring-accent focus:ring-2",
        props.className,
      )}
    />
  );
}
