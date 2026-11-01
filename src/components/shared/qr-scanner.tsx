"use client";

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect(source: HTMLVideoElement): Promise<DetectedBarcode[]> };
type BarcodeDetectorConstructor = new (options: { formats: string[] }) => BarcodeDetectorLike;

const noSubscription = () => () => {};

function barcodeDetector(): BarcodeDetectorConstructor | null {
  const value: unknown = Reflect.get(globalThis, "BarcodeDetector");
  return typeof value === "function" ? (value as BarcodeDetectorConstructor) : null;
}

/**
 * QR scanner with the back camera (BarcodeDetector, Chrome on Android) and a
 * text field for typed / pasted codes or a keyboard-like scanner. Calls
 * onCode once per detected code; the parent decides what it means.
 */
export function QrScanner({
  onCode,
  labels,
}: {
  onCode: (code: string) => void;
  labels: { hold: string; cameraFailed: string; unsupported: string; manual: string; open: string };
}) {
  const video = useRef<HTMLVideoElement>(null);
  // Known only in the browser; the server renders the camera view.
  const supported = useSyncExternalStore(
    noSubscription,
    () => barcodeDetector() !== null,
    () => true,
  );
  const [state, setState] = useState<"starting" | "running" | "failed">("starting");
  const [manual, setManual] = useState("");
  const found = useEffectEvent((code: string) => onCode(code));

  useEffect(() => {
    const Detector = barcodeDetector();
    if (!Detector || !navigator.mediaDevices?.getUserMedia) return;
    const detector = new Detector({ formats: ["qr_code"] });
    let stream: MediaStream | null = null;
    let timer = 0;
    let done = false;
    let last = "";
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then(async (media) => {
        stream = media;
        if (!video.current) return;
        video.current.srcObject = media;
        await video.current.play();
        setState("running");
        const tick = async () => {
          if (done || !video.current) return;
          try {
            const first = (await detector.detect(video.current))[0];
            // The same code stays in view: report it once.
            if (first && first.rawValue !== last) {
              last = first.rawValue;
              found(first.rawValue);
            }
          } catch {
            // Next frame.
          }
          timer = window.setTimeout(() => void tick(), 250);
        };
        void tick();
      })
      .catch(() => setState("failed"));
    return () => {
      done = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (manual.trim()) onCode(manual.trim());
  };

  return (
    <div className="flex flex-col gap-4">
      {!supported ? (
        <p className="text-sm text-muted-foreground">{labels.unsupported}</p>
      ) : state === "failed" ? (
        <p className="text-sm text-destructive">{labels.cameraFailed}</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{labels.hold}</p>
          <video
            ref={video}
            muted
            playsInline
            className="aspect-square w-full max-w-md rounded-xl bg-black object-cover"
          />
        </>
      )}
      <form onSubmit={submit} className="flex items-end gap-2">
        <Field className="flex-1">
          <FieldLabel htmlFor="qr-manual">{labels.manual}</FieldLabel>
          <Input
            id="qr-manual"
            value={manual}
            autoComplete="off"
            className="h-12"
            onChange={(event) => setManual(event.target.value)}
          />
        </Field>
        <Button type="submit" size="lg">
          {labels.open}
        </Button>
      </form>
    </div>
  );
}
