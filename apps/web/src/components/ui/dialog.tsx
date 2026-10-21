import * as React from "react";
import { Modal } from "@heroui/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type DialogCtx = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

const DialogContext = React.createContext<DialogCtx>({});

function Dialog({
  open,
  defaultOpen,
  onOpenChange,
  children,
}: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
}) {
  void defaultOpen;
  return (
    <DialogContext.Provider value={{ open, onOpenChange }}>
      {children}
    </DialogContext.Provider>
  );
}

function DialogTrigger({
  children,
  asChild,
  ...props
}: React.ComponentProps<"button"> & { asChild?: boolean }) {
  if (asChild && React.isValidElement(children)) {
    return <Modal.Trigger>{children}</Modal.Trigger>;
  }
  return (
    <Modal.Trigger>
      <Button type="button" {...props}>
        {children}
      </Button>
    </Modal.Trigger>
  );
}

function DialogPortal({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

function DialogClose({
  children,
  asChild,
  className,
  onClick,
  ...props
}: React.ComponentProps<"button"> & { asChild?: boolean }) {
  const { onOpenChange } = React.useContext(DialogContext);
  const close = (e: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(e);
    onOpenChange?.(false);
  };
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
      onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
        const childOnClick = (children as React.ReactElement<{ onClick?: typeof close }>).props.onClick;
        childOnClick?.(e);
        close(e);
      },
      "aria-label": (children as React.ReactElement<{ "aria-label"?: string }>).props["aria-label"] || "关闭",
    });
  }
  return (
    <Modal.CloseTrigger className={cn(className)} onPress={() => onOpenChange?.(false)} {...(props as object)}>
      {children}
    </Modal.CloseTrigger>
  );
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return <div className={cn("fixed inset-0 z-50 bg-overlay/50", className)} {...props} />;
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  overlayClassName,
  onEscapeKeyDown: _onEscapeKeyDown,
  onPointerDownOutside,
  onInteractOutside,
}: {
  className?: string;
  children?: React.ReactNode;
  showCloseButton?: boolean;
  overlayClassName?: string;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  onPointerDownOutside?: (event: Event) => void;
  onInteractOutside?: (event: Event) => void;
}) {
  void _onEscapeKeyDown;
  const { open, onOpenChange } = React.useContext(DialogContext);
  const dismissable = !(onPointerDownOutside || onInteractOutside);
  // Controlled closed: unmount so no leftover backdrop steals clicks.
  if (open === false) return null;
  return (
    <Modal.Backdrop
      isOpen={open ?? true}
      onOpenChange={(next) => {
        onOpenChange?.(next);
      }}
      isDismissable={dismissable}
      className={cn(overlayClassName)}
    >
      <Modal.Container
        size="cover"
        className="w-full"
        placement="center"
      >
        <Modal.Dialog
          className={cn(
            "relative grid w-full gap-4 overflow-hidden rounded-lg border border-border bg-background p-6 shadow-lg outline-none",
            className,
          )}
          role="dialog"
        >
          {children}
          {showCloseButton ? <Modal.CloseTrigger aria-label="关闭" /> : null}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <Modal.Header className={cn("flex flex-col gap-2 text-center sm:text-left", className)} {...props} />;
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & { showCloseButton?: boolean }) {
  return (
    <Modal.Footer className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props}>
      {children}
      {showCloseButton ? (
        <Modal.CloseTrigger>
          <Button variant="outline">关闭</Button>
        </Modal.CloseTrigger>
      ) : null}
    </Modal.Footer>
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return <Modal.Heading className={cn("text-lg font-semibold leading-none", className)} {...props} />;
}

function DialogDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-sm text-muted", className)} {...props} />;
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
