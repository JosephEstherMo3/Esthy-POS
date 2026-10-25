"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, FlipHorizontal, RefreshCw, Volume2, VolumeX, X, Zap, ZapOff } from "lucide-react";
import { Button, Modal } from "@/components/ui";

export function playScanBeep() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(1760, ctx.currentTime); // Crisp, pleasant A6 beep
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.14);
  } catch {
    // Ignore audio permission or context restrictions
  }
}

interface CameraScannerModalProps {
  open: boolean;
  onClose: () => void;
  onScan: (decodedText: string) => void;
  title?: string;
  description?: string;
  continuous?: boolean;
}

export function CameraScannerModal({
  open,
  onClose,
  onScan,
  title = "Scan barcode",
  description = "Point your camera at a product barcode or QR code.",
  continuous = false,
}: CameraScannerModalProps) {
  const [error, setError] = useState<string>("");
  const [cameras, setCameras] = useState<{ id: string; label: string }[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>("");
  const [torchOn, setTorchOn] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  // Reference to Html5Qrcode instance
  const html5QrCodeRef = useRef<any>(null);
  const readerElementId = "interactive-barcode-scanner";
  const lastScanTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!open) {
      return;
    }

    let isMounted = true;
    setError("");
    setLastScanned(null);
    setIsScanning(false);

    // Dynamically load Html5Qrcode to ensure clean client-side mounting
    import("html5-qrcode")
      .then(async ({ Html5Qrcode, Html5QrcodeSupportedFormats }) => {
        if (!isMounted) return;

        try {
          const devices = await Html5Qrcode.getCameras();
          if (!devices || devices.length === 0) {
            setError("No camera found on this device.");
            return;
          }

          setCameras(devices);
          // Prefer environment/back camera if available
          const backCam = devices.find((d) =>
            d.label.toLowerCase().includes("back") ||
            d.label.toLowerCase().includes("rear") ||
            d.label.toLowerCase().includes("environment"),
          );
          const activeCamId = backCam ? backCam.id : devices[0].id;
          setSelectedCameraId(activeCamId);

          const scanner = new Html5Qrcode(readerElementId, {
            formatsToSupport: [
              Html5QrcodeSupportedFormats.EAN_13,
              Html5QrcodeSupportedFormats.EAN_8,
              Html5QrcodeSupportedFormats.CODE_128,
              Html5QrcodeSupportedFormats.CODE_39,
              Html5QrcodeSupportedFormats.UPC_A,
              Html5QrcodeSupportedFormats.UPC_E,
              Html5QrcodeSupportedFormats.QR_CODE,
              Html5QrcodeSupportedFormats.ITF,
            ],
            verbose: false,
          });

          html5QrCodeRef.current = scanner;

          const config = {
            fps: 15,
            qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
              const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
              return {
                width: Math.floor(minEdge * 0.78),
                height: Math.floor(minEdge * 0.48),
              };
            },
            aspectRatio: 1.333333,
          };

          await scanner.start(
            activeCamId,
            config,
            (decodedText) => {
              const now = Date.now();
              // Prevent duplicate triggers within 1.2s for identical code
              if (decodedText === lastScanned && now - lastScanTimeRef.current < 1200) {
                return;
              }
              lastScanTimeRef.current = now;
              setLastScanned(decodedText);

              if (soundEnabled) {
                playScanBeep();
              }

              onScan(decodedText);

              if (!continuous) {
                // Stop and close
                scanner.stop().catch(() => {}).finally(() => {
                  onClose();
                });
              }
            },
            () => {
              // Ignore standard frame decoding errors
            },
          );

          if (!isMounted) {
            scanner.stop().catch(() => {});
            return;
          }

          setIsScanning(true);

          // Check if torch/flashlight capability is present
          try {
            const track = (scanner as any)._scannerState?.mediaStream?.getVideoTracks()?.[0];
            const capabilities = track?.getCapabilities?.();
            if (capabilities?.torch) {
              setHasTorch(true);
            }
          } catch {
            // Ignore capability check
          }
        } catch (err: any) {
          if (!isMounted) return;
          console.error("Camera scanner error:", err);
          if (err?.name === "NotAllowedError" || String(err).includes("Permission denied")) {
            setError("Camera permission was denied. Please allow camera access in your browser settings to scan barcodes.");
          } else {
            setError(err?.message || "Failed to start camera. Please make sure no other app is using it.");
          }
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setError("Failed to load scanner module: " + err.message);
      });

    return () => {
      isMounted = false;
      if (html5QrCodeRef.current) {
        html5QrCodeRef.current.stop().catch(() => {});
        html5QrCodeRef.current = null;
      }
    };
  }, [open, continuous, soundEnabled]);

  // Switch camera handler
  async function switchCamera() {
    if (!html5QrCodeRef.current || cameras.length < 2) return;
    const currentIndex = cameras.findIndex((c) => c.id === selectedCameraId);
    const nextCamera = cameras[(currentIndex + 1) % cameras.length];
    setSelectedCameraId(nextCamera.id);
    setIsScanning(false);

    try {
      await html5QrCodeRef.current.stop();
      await html5QrCodeRef.current.start(
        nextCamera.id,
        {
          fps: 15,
          qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
            return {
              width: Math.floor(minEdge * 0.78),
              height: Math.floor(minEdge * 0.48),
            };
          },
          aspectRatio: 1.333333,
        },
        (decodedText: string) => {
          const now = Date.now();
          if (decodedText === lastScanned && now - lastScanTimeRef.current < 1200) return;
          lastScanTimeRef.current = now;
          setLastScanned(decodedText);
          if (soundEnabled) playScanBeep();
          onScan(decodedText);
          if (!continuous) {
            html5QrCodeRef.current?.stop().catch(() => {}).finally(() => onClose());
          }
        },
        () => {},
      );
      setIsScanning(true);
    } catch (err: any) {
      setError(err?.message || "Failed to switch camera");
    }
  }

  // Toggle torch / flash
  async function toggleTorch() {
    if (!html5QrCodeRef.current) return;
    try {
      const nextTorch = !torchOn;
      await html5QrCodeRef.current.applyVideoConstraints({
        advanced: [{ torch: nextTorch }],
      });
      setTorchOn(nextTorch);
    } catch (e) {
      console.warn("Torch toggle not supported", e);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        if (html5QrCodeRef.current) {
          html5QrCodeRef.current.stop().catch(() => {}).finally(() => onClose());
        } else {
          onClose();
        }
      }}
      title={title}
      description={description}
      size="md"
      footer={
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSoundEnabled(!soundEnabled)}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
              title={soundEnabled ? "Mute scan beep" : "Unmute scan beep"}
            >
              {soundEnabled ? <Volume2 className="h-4 w-4 text-emerald-600" /> : <VolumeX className="h-4 w-4 text-slate-400" />}
              <span>{soundEnabled ? "Beep on" : "Muted"}</span>
            </button>
            {cameras.length > 1 && (
              <button
                type="button"
                onClick={switchCamera}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
              >
                <FlipHorizontal className="h-4 w-4 text-navy-700" />
                <span>Switch Camera</span>
              </button>
            )}
            {hasTorch && (
              <button
                type="button"
                onClick={toggleTorch}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
              >
                {torchOn ? <ZapOff className="h-4 w-4 text-amber-500" /> : <Zap className="h-4 w-4 text-slate-500" />}
                <span>{torchOn ? "Flash Off" : "Flash"}</span>
              </button>
            )}
          </div>
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      }
    >
      <div className="flex flex-col items-center">
        {error ? (
          <div className="my-4 w-full rounded-xl bg-red-50 p-5 text-center text-red-700">
            <Camera className="mx-auto mb-2 h-8 w-8 text-red-500" />
            <p className="text-sm font-semibold">{error}</p>
            <p className="mt-1 text-xs text-red-600">
              Ensure camera permissions are granted in browser settings or try another device with a working camera.
            </p>
          </div>
        ) : (
          <div className="relative w-full overflow-hidden rounded-2xl bg-black shadow-inner">
            {/* Html5Qrcode video rendering mount container */}
            <div id={readerElementId} className="w-full min-h-[280px]" />

            {/* Viewfinder Target & Laser Scanning Animation Overlay */}
            {isScanning && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="relative h-44 w-72 rounded-xl border-2 border-emerald-400/80 bg-emerald-500/5 shadow-[0_0_25px_rgba(16,185,129,0.25)]">
                  {/* Four Corner Marks */}
                  <span className="absolute -left-1 -top-1 h-5 w-5 border-l-4 border-t-4 border-emerald-400" />
                  <span className="absolute -right-1 -top-1 h-5 w-5 border-r-4 border-t-4 border-emerald-400" />
                  <span className="absolute -bottom-1 -left-1 h-5 w-5 border-b-4 border-l-4 border-emerald-400" />
                  <span className="absolute -bottom-1 -right-1 h-5 w-5 border-b-4 border-r-4 border-emerald-400" />

                  {/* Laser scan line animation */}
                  <div className="absolute inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_10px_#10b981] animate-bounce duration-1000" />
                </div>
              </div>
            )}

            {!isScanning && !error && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/90 text-white">
                <RefreshCw className="h-8 w-8 animate-spin text-emerald-400" />
                <p className="mt-3 text-xs font-medium text-slate-300">Initializing camera feed...</p>
              </div>
            )}
          </div>
        )}

        {lastScanned && (
          <div className="mt-3 flex items-center justify-between rounded-lg bg-emerald-50 px-4 py-2 text-xs font-medium text-emerald-800 w-full border border-emerald-200">
            <span>Scanned: <strong>{lastScanned}</strong></span>
            {continuous && <span className="text-[11px] text-emerald-600">Keep scanning items...</span>}
          </div>
        )}

        <p className="mt-3 text-center text-xs text-slate-500">
          Position the barcode inside the green frame. Works with retail barcodes (EAN-13, UPC) and QR codes.
        </p>
      </div>
    </Modal>
  );
}
