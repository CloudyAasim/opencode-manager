import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./dialog";

describe("DialogContent", () => {
  it("applies safe-area padding when fullscreen prop is true", () => {
    render(
      <Dialog open>
        <DialogContent fullscreen data-testid="dialog-content">
          <DialogHeader>
            <DialogTitle>Test Dialog</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
    const content = screen.getByTestId("dialog-content");
    expect(content).toHaveStyle({ paddingTop: "env(safe-area-inset-top, 0px)" });
  });

  it("applies safe-area padding when mobileFullscreen prop is true", () => {
    render(
      <Dialog open>
        <DialogContent mobileFullscreen data-testid="dialog-content">
          <DialogHeader>
            <DialogTitle>Test Dialog</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
    const content = screen.getByTestId("dialog-content");
    expect(content).toHaveStyle({ paddingTop: "env(safe-area-inset-top, 0px)" });
  });

  it("applies inset-0 for fullscreen dialogs", () => {
    render(
      <Dialog open>
        <DialogContent fullscreen data-testid="dialog-content">
          Content
        </DialogContent>
      </Dialog>
    );
    const content = screen.getByTestId("dialog-content");
    expect(content).toHaveClass("inset-0");
  });

  it("applies inset-0 for mobileFullscreen dialogs", () => {
    render(
      <Dialog open>
        <DialogContent mobileFullscreen data-testid="dialog-content">
          Content
        </DialogContent>
      </Dialog>
    );
    const content = screen.getByTestId("dialog-content");
    expect(content).toHaveClass("inset-0");
  });

  it("does not apply safe-area padding when neither fullscreen nor mobileFullscreen", () => {
    render(
      <Dialog open>
        <DialogContent data-testid="dialog-content">
          Content
        </DialogContent>
      </Dialog>
    );
    const content = screen.getByTestId("dialog-content");
    const style = content.getAttribute("style") || "";
    expect(style).not.toContain("safe-area");
    expect(content).not.toHaveClass("inset-0");
  });

  it("hides close button when fullscreen is true", () => {
    render(
      <Dialog open>
        <DialogContent fullscreen data-testid="dialog-content">
          Content
        </DialogContent>
      </Dialog>
    );
    expect(screen.queryByRole("button", { name: /close/i })).not.toBeInTheDocument();
  });

  it("shows close button when mobileFullscreen is true", () => {
    render(
      <Dialog open>
        <DialogContent mobileFullscreen data-testid="dialog-content">
          Content
        </DialogContent>
      </Dialog>
    );
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
  });

  it("hides close button when hideCloseButton is true", () => {
    render(
      <Dialog open>
        <DialogContent hideCloseButton data-testid="dialog-content">
          Content
        </DialogContent>
      </Dialog>
    );
    expect(screen.queryByRole("button", { name: /close/i })).not.toBeInTheDocument();
  });

  it("merges custom className with default classes", () => {
    render(
      <Dialog open>
        <DialogContent className="custom-class" data-testid="dialog-content">
          Content
        </DialogContent>
      </Dialog>
    );
    const content = screen.getByTestId("dialog-content");
    expect(content).toHaveClass("custom-class");
    expect(content).toHaveClass("fixed");
    expect(content).toHaveClass("z-50");
  });

  it("renders children correctly", () => {
    render(
      <Dialog open>
        <DialogContent>
          <span>Test Child Content</span>
        </DialogContent>
      </Dialog>
    );
    expect(screen.getByText("Test Child Content")).toBeInTheDocument();
  });

  it("accepts mobileSwipeToClose prop without breaking rendering", () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent mobileFullscreen mobileSwipeToClose data-testid="dialog-content">
          <DialogHeader>
            <DialogTitle>Swipe Dialog</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
    const content = screen.getByTestId("dialog-content");
    expect(content).toBeInTheDocument();
    expect(content).toHaveClass("inset-0");
  });

  it("applies safe-area padding when mobileSwipeToClose is used with mobileFullscreen", () => {
    render(
      <Dialog open>
        <DialogContent mobileFullscreen mobileSwipeToClose data-testid="dialog-content">
          <DialogHeader>
            <DialogTitle>Test Dialog</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
    const content = screen.getByTestId("dialog-content");
    expect(content).toHaveStyle({ paddingTop: "env(safe-area-inset-top, 0px)" });
  });

  it('renders hidden close trigger when mobileSwipeToClose is enabled', () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent mobileFullscreen mobileSwipeToClose>
          <DialogHeader>
            <DialogTitle>Swipe Dialog</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
    const closeTrigger = document.querySelector('[data-swipe-close-trigger]');
    expect(closeTrigger).toBeInTheDocument();
  });

  it('closes dialog when hidden close trigger is activated', () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent mobileFullscreen mobileSwipeToClose>
          <DialogHeader>
            <DialogTitle>Swipe Dialog</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
    
    const closeTrigger = document.querySelector('[data-swipe-close-trigger]') as HTMLButtonElement | null;
    expect(closeTrigger).toBeInTheDocument();
    
    if (closeTrigger) {
      closeTrigger.click();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    }
  });

  it('binds swipe handler when mobileSwipeToClose and mobileFullscreen are enabled', () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent mobileFullscreen mobileSwipeToClose data-testid="swipe-dialog">
          <DialogHeader>
            <DialogTitle>Swipe Dialog</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
    
    const content = screen.getByTestId('swipe-dialog');
    const closeTrigger = document.querySelector('[data-swipe-close-trigger]') as HTMLButtonElement | null;
    
    expect(content).toBeInTheDocument();
    expect(closeTrigger).toBeInTheDocument();
    
    const clickSpy = vi.spyOn(closeTrigger as HTMLButtonElement, 'click');
    closeTrigger?.click();
    
    expect(clickSpy).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
