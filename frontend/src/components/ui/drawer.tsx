"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils/cn";

const Drawer = DialogPrimitive.Root;
const DrawerTrigger = DialogPrimitive.Trigger;
const DrawerPortal = DialogPrimitive.Portal;
const DrawerClose = DialogPrimitive.Close;

const DrawerOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
));
DrawerOverlay.displayName = "DrawerOverlay";

const DrawerContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { widthClassName?: string }
>(({ className, widthClassName, children, ...props }, ref) => (
  <DrawerPortal>
    <DrawerOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed inset-y-0 right-0 z-50 flex h-full w-full flex-col border-l border-[var(--os-border,var(--border))] bg-[var(--os-surface,var(--surface))] shadow-2xl outline-none",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right data-[state=closed]:duration-200 data-[state=open]:duration-250",
        widthClassName ?? "sm:max-w-lg",
        className
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DrawerPortal>
));
DrawerContent.displayName = "DrawerContent";

function DrawerHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-start justify-between gap-4 border-b border-[var(--os-border-subtle,var(--border))] px-6 py-5",
        className
      )}
      {...props}
    />
  );
}

function DrawerBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex-1 overflow-y-auto px-6 py-5", className)} {...props} />
  );
}

function DrawerFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col-reverse gap-2 border-t border-[var(--os-border-subtle,var(--border))] px-6 py-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  );
}

const DrawerTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-base font-semibold text-[var(--os-text,var(--foreground))]", className)}
    {...props}
  />
));
DrawerTitle.displayName = "DrawerTitle";

const DrawerDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-[var(--os-text-muted,var(--muted-foreground))]", className)}
    {...props}
  />
));
DrawerDescription.displayName = "DrawerDescription";

function DrawerCloseButton({ className }: { className?: string }) {
  return (
    <DialogPrimitive.Close
      className={cn(
        "shrink-0 rounded-full p-1.5 text-[var(--os-text-muted,var(--muted-foreground))] transition-colors hover:bg-[var(--os-bg,var(--background))] hover:text-[var(--os-text,var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[var(--os-teal,var(--ring))]",
        className
      )}
      aria-label="Cerrar"
    >
      <X className="size-4" aria-hidden="true" />
    </DialogPrimitive.Close>
  );
}

export {
  Drawer,
  DrawerTrigger,
  DrawerPortal,
  DrawerOverlay,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerBody,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
  DrawerCloseButton,
};
