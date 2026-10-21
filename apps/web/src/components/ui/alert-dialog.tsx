import * as React from "react";
import { AlertDialog as HeroAlert } from "@heroui/react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/buttonVariants";

type Ctx = { open?: boolean; onOpenChange?: (open: boolean) => void };
const AlertCtx = React.createContext<Ctx>({});

const AlertDialog = ({
  open,
  onOpenChange,
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
}) => (
  <AlertCtx.Provider value={{ open, onOpenChange }}>
    <HeroAlert>{children}</HeroAlert>
  </AlertCtx.Provider>
);

const AlertDialogTrigger = ({ children, ...props }: React.ComponentProps<"div">) => (
  <HeroAlert.Trigger {...props}>{children}</HeroAlert.Trigger>
);

const AlertDialogPortal = ({ children }: { children?: React.ReactNode }) => <>{children}</>;

const AlertDialogOverlay = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div className={cn("fixed inset-0 z-50 bg-overlay/40", className)} {...props} />
);

const AlertDialogContent = React.forwardRef<
  HTMLDivElement,
  { className?: string; children?: React.ReactNode }
>(({ className, children }, _ref) => {
  const { open, onOpenChange } = React.useContext(AlertCtx);
  return (
    <HeroAlert.Backdrop
      isOpen={open}
      onOpenChange={onOpenChange}
      isDismissable={false}
      isKeyboardDismissDisabled
    >
      <HeroAlert.Container size="md" placement="center">
        <HeroAlert.Dialog
          role="alertdialog"
          className={cn(
            "grid w-full max-w-md gap-4 border border-border bg-surface p-6 shadow-lg sm:rounded-lg",
            className,
          )}
        >
          {children}
        </HeroAlert.Dialog>
      </HeroAlert.Container>
    </HeroAlert.Backdrop>
  );
});
AlertDialogContent.displayName = "AlertDialogContent";

function AlertDialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <HeroAlert.Header className={cn("flex flex-col space-y-2 text-center sm:text-left", className)} {...props} />;
}

function AlertDialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <HeroAlert.Footer className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />
  );
}

const AlertDialogTitle = React.forwardRef<HTMLHeadingElement, React.ComponentProps<"h2">>(
  ({ className, ...props }, _ref) => (
    <HeroAlert.Heading className={cn("text-lg font-semibold text-foreground", className)} {...props} />
  ),
);
AlertDialogTitle.displayName = "AlertDialogTitle";

const AlertDialogDescription = React.forwardRef<HTMLParagraphElement, React.ComponentProps<"p">>(
  ({ className, ...props }, _ref) => (
    <p className={cn("text-sm text-muted", className)} {...props} />
  ),
);
AlertDialogDescription.displayName = "AlertDialogDescription";

const AlertDialogAction = React.forwardRef<HTMLButtonElement, React.ComponentProps<"button">>(
  ({ className, ...props }, ref) => (
    <button ref={ref} type="button" className={cn(buttonVariants(), className)} {...props} />
  ),
);
AlertDialogAction.displayName = "AlertDialogAction";

const AlertDialogCancel = React.forwardRef<HTMLButtonElement, React.ComponentProps<"button">>(
  ({ className, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      slot="close"
      className={cn(buttonVariants({ variant: "outline" }), className)}
      {...props}
    />
  ),
);
AlertDialogCancel.displayName = "AlertDialogCancel";

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
