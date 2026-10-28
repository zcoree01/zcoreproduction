"use client";

import {
  ArrowLeftIcon,
  CameraIcon,
  DeleteIcon,
  LogInIcon,
  LogOutIcon,
  NfcIcon,
  SearchIcon,
  UserIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { kioskClockAction, type KioskClockResult } from "@/modules/attendance/kiosk-actions";
import type { KioskEmployee } from "@/modules/attendance/kiosk-device";
import { acceptScan } from "@/modules/attendance/kiosk-rules";

// Browser APIs not (yet) in the TypeScript DOM library.
type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect(source: HTMLVideoElement): Promise<DetectedBarcode[]> };
type BarcodeDetectorConstructor = new (options: { formats: string[] }) => BarcodeDetectorLike;
type NdefRecord = { recordType: string; encoding?: string; data?: DataView };
type NdefReaderLike = {
  scan(options?: { signal?: AbortSignal }): Promise<void>;
  addEventListener(
    type: "reading",
    listener: (event: { message: { records: NdefRecord[] } }) => void,
  ): void;
};
type NdefReaderConstructor = new () => NdefReaderLike;

function barcodeDetector(): BarcodeDetectorConstructor | null {
  const value: unknown = Reflect.get(globalThis, "BarcodeDetector");
  return typeof value === "function" ? (value as BarcodeDetectorConstructor) : null;
}

function ndefReader(): NdefReaderConstructor | null {
  const value: unknown = Reflect.get(globalThis, "NDEFReader");
  return typeof value === "function" ? (value as NdefReaderConstructor) : null;
}

function subscribeClock(onChange: () => void) {
  const timer = window.setInterval(onChange, 1000);
  return () => window.clearInterval(timer);
}

function currentSecond(): number {
  return Math.floor(Date.now() / 1000);
}

function subscribeNever() {
  return () => {};
}

function cameraAvailable(): boolean {
  return barcodeDetector() !== null && Boolean(navigator.mediaDevices);
}

function nfcAvailable(): boolean {
  return ndefReader() !== null;
}

type View =
  | { name: "idle" }
  | { name: "names" }
  | { name: "pin"; employee: KioskEmployee }
  | { name: "camera" }
  | { name: "result"; result: KioskClockResult };

const RESULT_MS = 6000;

/**
 * The kiosk: a large clock and three ways to identify — badge (camera QR,
 * NFC tag or a keyboard-like scanner), or choosing the name and entering the
 * PIN. Each identification toggles clock-in / clock-out; the result stays
 * on screen for a few seconds, then the kiosk is ready for the next worker.
 */
export function KioskScreen(props: {
  kioskName: string;
  organizationName: string;
  timeZone: string;
  employees: KioskEmployee[];
}) {
  const t = useTranslations("kiosk");
  const [view, setView] = useState<View>({ name: "idle" });
  // Client-only values (null / false on the server, no hydration mismatch).
  const second = useSyncExternalStore(subscribeClock, currentSecond, () => null);
  const now = second === null ? null : new Date(second * 1000);
  const [pending, startTransition] = useTransition();
  const hasCamera = useSyncExternalStore(subscribeNever, cameraAvailable, () => false);
  const hasNfc = useSyncExternalStore(subscribeNever, nfcAvailable, () => false);
  const typed = useRef({ text: "", at: 0 });
  // Last accepted badge scan: a card held at the reader is read many times.
  const lastScan = useRef<number | null>(null);
  const nfc = useRef<NdefReaderLike | null>(null);
  const [nfcState, setNfcState] = useState<"off" | "on" | "failed">("off");

  useEffect(() => {
    if (view.name !== "result") return;
    const timer = window.setTimeout(() => setView({ name: "idle" }), RESULT_MS);
    return () => window.clearTimeout(timer);
  }, [view]);

  const send = (input: Parameters<typeof kioskClockAction>[0]) =>
    startTransition(async () => {
      let result: KioskClockResult;
      try {
        result = await kioskClockAction(input);
      } catch {
        result = { ok: false, error: "unexpected" };
      }
      setView({ name: "result", result });
    });

  const sendBadge = (badge: string) => {
    const at = Date.now();
    if (pending || !acceptScan(at, lastScan.current)) return;
    lastScan.current = at;
    send({ method: "badge", badge, idempotencyKey: crypto.randomUUID() });
  };

  // Keyboard-like badge scanners type the token and Enter.
  const onScannerKey = useEffectEvent((event: KeyboardEvent) => {
    const state = typed.current;
    if (event.timeStamp - state.at > 500) state.text = "";
    state.at = event.timeStamp;
    if (event.key === "Enter") {
      if (state.text.length >= 24) sendBadge(state.text);
      state.text = "";
    } else if (event.key.length === 1) {
      state.text += event.key;
    }
  });
  useEffect(() => {
    if (view.name !== "idle") return;
    const onKey = (event: KeyboardEvent) => onScannerKey(event);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view.name]);

  // NFC: one reader stays on while the kiosk page is open (scanning only
  // after a tap per card would hand later cards to Android instead).
  const onNfcReading = useEffectEvent((records: NdefRecord[]) => {
    const record = records.find((item) => item.recordType === "text" || item.recordType === "url");
    if (record?.data) sendBadge(new TextDecoder(record.encoding ?? "utf-8").decode(record.data));
  });
  // Turned on by a tap (the browser asks for permission once), then kept on.
  const [nfcRequested, setNfcRequested] = useState(false);
  useEffect(() => {
    const Reader = ndefReader();
    if (!nfcRequested || !Reader || nfc.current) return;
    const reader = new Reader();
    reader.addEventListener("reading", (event) => onNfcReading(event.message.records));
    reader
      .scan()
      .then(() => {
        nfc.current = reader;
        setNfcState("on");
      })
      .catch(() => {
        setNfcRequested(false);
        setNfcState("failed");
      });
  }, [nfcRequested]);

  const clock = now
    ? new Intl.DateTimeFormat("bs", {
        timeZone: props.timeZone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(now)
    : "--:--";

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="text-lg font-semibold">{props.organizationName}</div>
          <div className="text-sm text-muted-foreground">{props.kioskName}</div>
        </div>
        <div className="text-5xl font-semibold tabular-nums sm:text-6xl" aria-live="off">
          {clock}
        </div>
      </header>

      {view.name === "idle" ? (
        <section className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
          <h1 className="text-3xl font-semibold sm:text-4xl">{t("welcome")}</h1>
          <p className="text-lg text-muted-foreground">{t("instructions")}</p>
          <div className="grid w-full max-w-xl gap-3 sm:grid-cols-2">
            {hasCamera ? (
              <Button
                size="lg"
                variant="outline"
                className="h-20 text-lg"
                onClick={() => setView({ name: "camera" })}
              >
                <CameraIcon className="size-6" />
                {t("scanQr")}
              </Button>
            ) : null}
            {hasNfc && nfcState !== "on" ? (
              <Button
                size="lg"
                variant="outline"
                className="h-20 text-lg"
                onClick={() => setNfcRequested(true)}
              >
                <NfcIcon className="size-6" />
                {t("startNfc")}
              </Button>
            ) : null}
            {nfcState === "on" ? (
              <p
                className="flex h-20 items-center justify-center gap-2 rounded-lg border border-emerald-500 text-lg"
                data-testid="nfc-on"
              >
                <NfcIcon className="size-6 text-emerald-600" aria-hidden />
                {t("nfcOn")}
              </p>
            ) : null}
            <Button
              size="lg"
              className="h-20 text-lg sm:col-span-2"
              onClick={() => setView({ name: "names" })}
            >
              <UserIcon className="size-6" />
              {t("byName")}
            </Button>
          </div>
          {nfcState === "failed" ? (
            <p className="text-sm text-destructive">{t("nfcFailed")}</p>
          ) : null}
          <p className="text-sm text-muted-foreground">{t("scannerHint")}</p>
        </section>
      ) : null}

      {view.name === "names" ? (
        <NamePicker
          employees={props.employees}
          onBack={() => setView({ name: "idle" })}
          onPick={(employee) => setView({ name: "pin", employee })}
        />
      ) : null}

      {view.name === "pin" ? (
        <PinPad
          employee={view.employee}
          pending={pending}
          onBack={() => setView({ name: "names" })}
          onSubmit={(pin) =>
            send({
              method: "pin",
              employeeId: view.employee.id,
              pin,
              idempotencyKey: crypto.randomUUID(),
            })
          }
        />
      ) : null}

      {view.name === "camera" ? (
        <CameraScanner
          onBack={() => setView({ name: "idle" })}
          onCode={(code) => sendBadge(code)}
        />
      ) : null}

      {view.name === "result" ? (
        <ResultView
          result={view.result}
          timeZone={props.timeZone}
          onDone={() => setView({ name: "idle" })}
        />
      ) : null}
    </div>
  );
}

function NamePicker({
  employees,
  onBack,
  onPick,
}: {
  employees: KioskEmployee[];
  onBack: () => void;
  onPick: (employee: KioskEmployee) => void;
}) {
  const t = useTranslations("kiosk");
  const [search, setSearch] = useState("");
  const needle = search.trim().toLocaleLowerCase("bs");
  const shown = employees.filter(
    (employee) =>
      employee.hasPin && (!needle || employee.name.toLocaleLowerCase("bs").includes(needle)),
  );
  return (
    <section className="flex flex-1 flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="lg" className="h-14" onClick={onBack}>
          <ArrowLeftIcon />
          {t("back")}
        </Button>
        <div className="relative flex-1">
          <SearchIcon
            className="absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("searchName")}
            aria-label={t("searchName")}
            className="h-14 pl-10 text-lg"
          />
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">{t("noNames")}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((employee) => (
            <li key={employee.id}>
              <Button
                variant="outline"
                className="h-16 w-full justify-between text-left text-lg"
                onClick={() => onPick(employee)}
              >
                <span className="truncate">{employee.name}</span>
                {employee.present ? (
                  <span className="text-xs text-emerald-700 dark:text-emerald-300">
                    {t("present")}
                  </span>
                ) : null}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-muted-foreground">{t("noPinHint")}</p>
    </section>
  );
}

function PinPad({
  employee,
  pending,
  onBack,
  onSubmit,
}: {
  employee: KioskEmployee;
  pending: boolean;
  onBack: () => void;
  onSubmit: (pin: string) => void;
}) {
  const t = useTranslations("kiosk");
  const [pin, setPin] = useState("");
  const press = (digit: string) => {
    if (pending) return;
    const next = (pin + digit).slice(0, 4);
    setPin(next);
    if (next.length === 4) onSubmit(next);
  };
  return (
    <section className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center gap-4">
      <Button variant="ghost" className="self-start" onClick={onBack}>
        <ArrowLeftIcon />
        {t("back")}
      </Button>
      <h2 className="text-2xl font-semibold">{employee.name}</h2>
      <p className="text-muted-foreground">{t("enterPin")}</p>
      <div className="flex gap-3" aria-label={t("pinProgress", { count: pin.length })}>
        {[0, 1, 2, 3].map((index) => (
          <span
            key={index}
            className={cn(
              "size-5 rounded-full border-2",
              index < pin.length ? "bg-foreground" : "bg-transparent",
            )}
          />
        ))}
      </div>
      <div className="grid w-full grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
          <Button
            key={digit}
            variant="outline"
            className="h-20 text-3xl"
            onClick={() => press(digit)}
          >
            {digit}
          </Button>
        ))}
        <span />
        <Button variant="outline" className="h-20 text-3xl" onClick={() => press("0")}>
          0
        </Button>
        <Button
          variant="ghost"
          className="h-20"
          aria-label={t("deleteDigit")}
          onClick={() => setPin((current) => current.slice(0, -1))}
        >
          <DeleteIcon className="size-7" />
        </Button>
      </div>
    </section>
  );
}

function CameraScanner({ onBack, onCode }: { onBack: () => void; onCode: (code: string) => void }) {
  const t = useTranslations("kiosk");
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const found = useEffectEvent((code: string) => onCode(code));

  useEffect(() => {
    const Detector = barcodeDetector();
    if (!Detector) return;
    const detector = new Detector({ formats: ["qr_code"] });
    let stream: MediaStream | null = null;
    let timer = 0;
    let done = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user" } })
      .then(async (media) => {
        stream = media;
        if (!video.current) return;
        video.current.srcObject = media;
        await video.current.play();
        const tick = async () => {
          if (done || !video.current) return;
          try {
            const codes = await detector.detect(video.current);
            const first = codes[0];
            if (first) {
              done = true;
              found(first.rawValue);
              return;
            }
          } catch {
            // Next frame.
          }
          timer = window.setTimeout(() => void tick(), 250);
        };
        void tick();
      })
      .catch(() => setFailed(true));
    return () => {
      done = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <section className="flex flex-1 flex-col items-center gap-4">
      <Button variant="outline" size="lg" className="self-start" onClick={onBack}>
        <ArrowLeftIcon />
        {t("back")}
      </Button>
      {failed ? <p className="text-destructive">{t("cameraFailed")}</p> : <p>{t("holdBadge")}</p>}
      <video
        ref={video}
        muted
        playsInline
        className="aspect-video w-full max-w-xl rounded-xl bg-black object-cover"
      />
    </section>
  );
}

function ResultView({
  result,
  timeZone,
  onDone,
}: {
  result: KioskClockResult;
  timeZone: string;
  onDone: () => void;
}) {
  const t = useTranslations("kiosk");
  if (!result.ok) {
    return (
      <section
        className="flex flex-1 flex-col items-center justify-center gap-6 rounded-2xl border-4 border-destructive p-8 text-center"
        data-testid="kiosk-result"
      >
        <p className="text-3xl font-semibold">{t(`errors.${result.error}`)}</p>
        <Button size="lg" className="h-14 text-lg" onClick={onDone}>
          {t("again")}
        </Button>
      </section>
    );
  }
  const time = new Intl.DateTimeFormat("bs", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(result.at));
  const arriving = result.direction === "in";
  return (
    <section
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-4 rounded-2xl border-4 p-8 text-center",
        arriving ? "border-emerald-500" : "border-sky-500",
      )}
      data-testid="kiosk-result"
    >
      {arriving ? (
        <LogInIcon className="size-16 text-emerald-600" />
      ) : (
        <LogOutIcon className="size-16 text-sky-600" />
      )}
      <p className="text-4xl font-semibold">
        {arriving
          ? t("hello", { name: result.employeeName })
          : t("goodbye", { name: result.employeeName })}
      </p>
      {result.repeat ? (
        <p className="text-lg text-muted-foreground">{t("alreadyRecorded")}</p>
      ) : null}
      <p className="text-2xl">
        {arriving ? t("clockedIn", { time }) : t("clockedOut", { time })}
        {arriving && result.shiftCode ? ` · ${t("shift", { code: result.shiftCode })}` : ""}
      </p>
      <Button variant="outline" size="lg" className="h-14 text-lg" onClick={onDone}>
        {t("next")}
      </Button>
    </section>
  );
}
