import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition disabled:pointer-events-none disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay",
  {
    variants: {
      variant: {
        default: "bg-clay text-white hover:bg-clay-dark",
        outline: "border border-line bg-card hover:bg-paper",
        ghost: "hover:bg-black/5",
        pine: "bg-pine text-white hover:opacity-90",
        danger: "border border-red-200 bg-white text-red-700 hover:bg-red-50",
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
        "h-10 w-full rounded-lg border border-line bg-card px-3 text-sm outline-none ring-clay focus:ring-2",
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
        "min-h-24 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm outline-none ring-clay focus:ring-2",
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
    neutral: "bg-black/5 text-ink",
    pine: "bg-pine/10 text-pine",
    clay: "bg-clay/10 text-clay-dark",
    amber: "bg-amber/40 text-ink",
    danger: "bg-red-100 text-red-800",
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
        "h-10 w-full rounded-lg border border-line bg-card px-3 text-sm outline-none ring-clay focus:ring-2",
        props.className,
      )}
    />
  );
}
