// src/hooks/useDevicePingStatus.js
import { useCallback, useEffect, useRef, useState } from "react";

export function useDevicePingStatus({ ws, apiUrl, deviceId }) {
  const [status, setStatus] = useState("checking"); // "checking" | "online" | "offline"
  const timerRef = useRef(null);

  // --- helpers ---
  const isHi = (p) => String(p).trim().toLowerCase() === "hi!";
  const isBye = (p) => {
    const v = String(p).trim().toLowerCase();
    return v === "byebye" || v === "offline"; // por si luego usas LWT "offline"
  };

  // envía el ping inicial por POST (no JSON al device; el backend reenvía "hi" como string)
  const ask = useCallback(async () => {
    setStatus("checking");
    if (timerRef.current) clearTimeout(timerRef.current);

    try {
      await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId,
          path: "askInfo",
          value: "hi" // <- cadena que tu IoT entiende
        })
      });
    } catch (e) {
      console.error("Error enviando hi:", e);
    }

    // si no hay respuesta, marcamos OFFLINE
    timerRef.current = setTimeout(() => setStatus("offline"), 4000);
  }, [apiUrl, deviceId]);

  useEffect(() => {
    if (!ws) return;

    const handleMessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const topic = data?.topic;
        const payload = data?.payload;

        // 1) Respuesta al ping inicial
        if (topic === "mod_1x1/d_000/answerInfo" && isHi(payload)) {
          setStatus("online");
          if (timerRef.current) clearTimeout(timerRef.current);
          return;
        }

        // 2) Señales en el topic will
        if (topic === "mod_1x1/d_000/will") {
          if (isHi(payload)) {
            setStatus("online");
            if (timerRef.current) clearTimeout(timerRef.current);
            return;
          }
          if (isBye(payload)) {
            setStatus("offline");
            if (timerRef.current) clearTimeout(timerRef.current);
            return;
          }
        }

        // (opcional futuro) si luego usas LWT en .../status → "offline"
        if (topic === "mod_1x1/d_000/status" && isBye(payload)) {
          setStatus("offline");
          if (timerRef.current) clearTimeout(timerRef.current);
          return;
        }
      } catch (e) {
        console.error("Error parsing WS message", e, event.data);
      }
    };

    ws.addEventListener("message", handleMessage);

    // 🔸 dispara el ask SOLO cuando el WS está listo, así no te pierdes la respuesta
    const triggerAsk = () => ask();
    if (ws.readyState === WebSocket.OPEN) {
      triggerAsk();
    } else {
      ws.addEventListener("open", triggerAsk, { once: true });
    }

    return () => {
      ws.removeEventListener("message", handleMessage);
      ws.removeEventListener("open", triggerAsk);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [ws, ask]);

  return { status, refresh: ask };
}
