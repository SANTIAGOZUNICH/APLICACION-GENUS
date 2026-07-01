"use client";

import { useState } from "react";
import { ActionFlowDialog } from "@/components/patterns/actions/action-flow-dialog";
import type { UseActionParams } from "@/components/patterns/actions/use-action";
import type { EntityCardAction } from "@/types/ui/entity-card";
import type { EntityPageKind } from "@/types/entity-page";
import type { Status } from "@/types/ui/status";
import { Button } from "@/components/ui/button";
import Link from "next/link";

interface ActionTriggerProps {
  action: EntityCardAction;
  entityKind: EntityPageKind;
  entityId: string;
  status: Status;
  surface: UseActionParams["surface"];
}

/** Dispatches an action through the Action Flow pipeline. */
export function ActionTrigger({
  action,
  entityKind,
  entityId,
  status,
  surface,
}: ActionTriggerProps) {
  const [open, setOpen] = useState(false);
  const variant = action.variant ?? "primary";

  if (action.href && !action.actionId) {
    return (
      <Button variant={variant} size="sm" asChild disabled={action.disabled}>
        <Link href={action.href}>{action.label}</Link>
      </Button>
    );
  }

  if (action.actionId) {
    const params: UseActionParams = {
      actionId: action.actionId,
      entityKind,
      entityId,
      status,
      surface,
    };

    return (
      <>
        <Button
          variant={variant}
          size="sm"
          disabled={action.disabled}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          }}
        >
          {action.label}
        </Button>
        <ActionFlowDialog open={open} onOpenChange={setOpen} params={params} />
      </>
    );
  }

  if (action.onClick) {
    return (
      <Button
        variant={variant}
        size="sm"
        onClick={action.onClick}
        disabled={action.disabled}
      >
        {action.label}
      </Button>
    );
  }

  return null;
}

interface ActionTriggerLinkProps {
  action: EntityCardAction;
  entityKind: EntityPageKind;
  entityId: string;
  status: Status;
  surface: UseActionParams["surface"];
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

/** Wraps card click area — href navigates, actionId opens flow. */
export function ActionableCardWrapper({
  action,
  entityKind,
  entityId,
  status,
  surface,
  children,
  className,
  href,
  onClick,
}: ActionTriggerLinkProps & { href?: string }) {
  const [open, setOpen] = useState(false);

  if (action.actionId) {
    const params: UseActionParams = {
      actionId: action.actionId,
      entityKind,
      entityId,
      status,
      surface,
    };

    return (
      <>
        <button
          type="button"
          className={className}
          onClick={(e) => {
            onClick?.();
            if (action.actionId) {
              e.preventDefault();
              setOpen(true);
            }
          }}
        >
          {children}
        </button>
        <ActionFlowDialog open={open} onOpenChange={setOpen} params={params} />
      </>
    );
  }

  if (href) {
    return (
      <Link href={href} className={className} onClick={onClick}>
        {children}
      </Link>
    );
  }

  return (
    <div className={className} onClick={onClick}>
      {children}
    </div>
  );
}
