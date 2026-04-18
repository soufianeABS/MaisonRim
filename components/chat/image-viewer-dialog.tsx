"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { X, Download, Pencil, Save, Loader2 } from "lucide-react";

type ImageViewerDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
  /** Suggested filename for the Download action */
  downloadFilename?: string;
  /** When set, download uses server proxy (avoids R2 CORS "Failed to fetch") */
  messageId?: string;
  onDownload: (url: string, filename: string, messageId?: string) => void;
  /** When set (1:1 chat), user can edit and send the image to the contact */
  onSendEdited?: (file: File) => Promise<void>;
  sending?: boolean;
};

function getCanvasPoint(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY,
  };
}

export function ImageViewerDialog({
  isOpen,
  onClose,
  imageUrl,
  downloadFilename = "image",
  messageId,
  onDownload,
  onSendEdited,
  sending = false,
}: ImageViewerDialogProps) {
  const [editMode, setEditMode] = useState(false);
  const [drawColor, setDrawColor] = useState("#ef4444");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preparingEdit, setPreparingEdit] = useState(false);

  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  const resetCanvases = useCallback(() => {
    const bg = bgCanvasRef.current;
    const dr = drawCanvasRef.current;
    if (bg) {
      const ctx = bg.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, bg.width, bg.height);
    }
    if (dr) {
      const ctx = dr.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, dr.width, dr.height);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setEditMode(false);
      setLoadError(null);
      setPreparingEdit(false);
      resetCanvases();
    }
  }, [isOpen, resetCanvases]);

  const loadImageToCanvases = useCallback(async () => {
    setLoadError(null);
    setPreparingEdit(true);
    try {
      const res = messageId
        ? await fetch("/api/media/download", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messageId,
              filename: downloadFilename || "image.jpg",
            }),
          })
        : await fetch(imageUrl, { mode: "cors", credentials: "omit" });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        let detail = errText;
        try {
          const j = JSON.parse(errText) as { error?: string };
          if (typeof j?.error === "string") detail = j.error;
        } catch {
          /* keep raw */
        }
        throw new Error(detail || `Could not load image (${res.status})`);
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      try {
        await new Promise<void>((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            const w = img.naturalWidth;
            const h = img.naturalHeight;
            const bg = bgCanvasRef.current;
            const dr = drawCanvasRef.current;
            if (!bg || !dr) {
              reject(new Error("Canvas not ready"));
              return;
            }
            bg.width = w;
            bg.height = h;
            dr.width = w;
            dr.height = h;
            const bctx = bg.getContext("2d");
            const dctx = dr.getContext("2d");
            if (!bctx || !dctx) {
              reject(new Error("Canvas unsupported"));
              return;
            }
            bctx.drawImage(img, 0, 0);
            dctx.clearRect(0, 0, w, h);
            resolve();
          };
          img.onerror = () => reject(new Error("Image decode failed"));
          img.src = objectUrl;
        });
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load image");
    } finally {
      setPreparingEdit(false);
    }
  }, [imageUrl, messageId, downloadFilename]);

  const startEdit = useCallback(() => {
    setEditMode(true);
    void loadImageToCanvases();
  }, [loadImageToCanvases]);

  const cancelEdit = useCallback(() => {
    setEditMode(false);
    resetCanvases();
    setLoadError(null);
  }, [resetCanvases]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (editMode) {
        cancelEdit();
      } else {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose, editMode, cancelEdit]);

  const drawLine = useCallback(
    (from: { x: number; y: number }, to: { x: number; y: number }) => {
      const canvas = drawCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.strokeStyle = drawColor;
      ctx.lineWidth = Math.max(3, canvas.width / 200);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    },
    [drawColor],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!editMode) return;
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const p = getCanvasPoint(canvas, e.clientX, e.clientY);
    lastPointRef.current = p;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!editMode || !drawingRef.current) return;
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const p = getCanvasPoint(canvas, e.clientX, e.clientY);
    const last = lastPointRef.current;
    if (last) {
      drawLine(last, p);
    }
    lastPointRef.current = p;
  };

  const onPointerUp = () => {
    drawingRef.current = false;
    lastPointRef.current = null;
  };

  const handleSaveAndSend = async () => {
    if (!onSendEdited) return;
    const bg = bgCanvasRef.current;
    const dr = drawCanvasRef.current;
    if (!bg || !dr || bg.width === 0) return;

    const merged = document.createElement("canvas");
    merged.width = bg.width;
    merged.height = bg.height;
    const mctx = merged.getContext("2d");
    if (!mctx) return;
    mctx.drawImage(bg, 0, 0);
    mctx.drawImage(dr, 0, 0);

    try {
      await new Promise<void>((resolve, reject) => {
        merged.toBlob(
          async (blob) => {
            if (!blob) {
              reject(new Error("Could not export image"));
              return;
            }
            const name =
              downloadFilename.replace(/\.[^.]+$/, "") || "edited-image";
            const file = new File([blob], `${name}-edited.png`, {
              type: "image/png",
            });
            try {
              await onSendEdited(file);
              resolve();
            } catch (err) {
              reject(err);
            }
          },
          "image/png",
          0.92,
        );
      });
      onClose();
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Could not send image");
    }
  };

  if (!isOpen) return null;

  const baseName =
    downloadFilename.replace(/\.[^.]+$/, "") || "chat-image";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      onClick={() => {
        if (editMode) cancelEdit();
        else onClose();
      }}
    >
      <div
        className="relative flex max-h-[92vh] max-w-[min(96vw,1200px)] flex-col overflow-hidden rounded-xl bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 sm:px-4">
          <div className="min-w-0 truncate text-sm font-medium text-muted-foreground">
            {editMode ? "Edit image" : "Image"}
          </div>
          <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-1 sm:gap-2">
            {!editMode && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() =>
                    onDownload(imageUrl, `${baseName}.jpg`, messageId)
                  }
                >
                  <Download className="h-4 w-4" />
                  Download
                </Button>
                {onSendEdited && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    onClick={startEdit}
                    disabled={sending}
                  >
                    <Pencil className="h-4 w-4" />
                    Edit
                  </Button>
                )}
              </>
            )}
            {editMode && (
              <>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="hidden sm:inline">Color</span>
                  <input
                    type="color"
                    value={drawColor}
                    onChange={(e) => setDrawColor(e.target.value)}
                    className="h-8 w-10 cursor-pointer rounded border border-border bg-background p-0"
                    aria-label="Drawing color"
                  />
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={cancelEdit}
                  disabled={sending || preparingEdit}
                >
                  Cancel edit
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="gap-1 bg-emerald-600 hover:bg-emerald-700"
                  onClick={() => void handleSaveAndSend()}
                  disabled={
                    sending || preparingEdit || !!loadError || !onSendEdited
                  }
                >
                  {sending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Save & send
                </Button>
              </>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0"
              onClick={onClose}
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3 sm:p-4">
          {!editMode && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt=""
              className="max-h-[min(78vh,800px)] max-w-full object-contain"
            />
          )}
          {editMode && (
            <div className="relative inline-block max-h-[min(78vh,800px)] max-w-full">
              {preparingEdit && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              )}
              {loadError && (
                <p className="text-center text-sm text-destructive">{loadError}</p>
              )}
              <div
                className={`relative inline-block max-w-full ${loadError ? "hidden" : ""}`}
              >
                <canvas
                  ref={bgCanvasRef}
                  className="block max-h-[min(78vh,800px)] max-w-full h-auto"
                />
                <canvas
                  ref={drawCanvasRef}
                  className="absolute left-0 top-0 h-full w-full cursor-crosshair touch-none"
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerLeave={onPointerUp}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
