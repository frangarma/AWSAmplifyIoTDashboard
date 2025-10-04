import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Toaster } from "@/components/ui/toaster";
import { useToast } from "@/components/ui/use-toast";
import { CheckCircle2, XCircle, Signal, Power, Clock, LogOut, ListChecks, Pencil, Activity } from "lucide-react";
import { ResponsiveContainer, ComposedChart, XAxis, YAxis, Tooltip, Bar, ReferenceLine } from "recharts";

/**
 * Panel IoT avanzado (single-file) – pensado para integrarse en tu app.
 *
 * ✔ Indicador de estado de dispositivo (heartbeat + LWT)
 * ✔ Filas dinámicas por relé: Toggle on/off, indicadores Rx/Status
 * ✔ Perfiles de usuario (Cognito): carga de dispositivos y configuración por usuario
 * ✔ Personalización de nombres de relés
 * ✔ Confirmación antes de accionar
 * ✔ Colores: apagado gris claro, encendido rojo
 * ✔ Gráfica timeline multi‑relé con notas
 * ✔ Registro de acciones con notas
 * ✔ Gestión de programas (crear/listar/borrar)
 * ✔ Cierre de sesión por inactividad
 *
 * NOTAS DE INTEGRACIÓN
 * - MQTT: este ejemplo define una interfaz IMqttClient y un mock opcional para desarrollo.
 *   En producción, conecta AWS IoT Core (MQTT over WebSocket) autenticando con Cognito.
 * - Cognito: sustituye stubs getUser() y getUserDevices() por llamadas reales.
 * - Tailwind + shadcn/ui + recharts requeridos en el proyecto.
 */

// -------------------- Tipos de dominio --------------------

type RelayKey = `k${1|2|3|4|5|6|7|8}` | string; // flexible, por si hay >4

type RelayConfig = {
  key: RelayKey;          // p.ej. "k1"
  name: string;           // nombre visible (editable)
  statusTopic: string;    // mod_1x1/d_000/k1/status
  feedbackTopic: string;  // mod_1x1/d_000/k1/feedback
  cmdTopic: string;       // mod_1x1/d_000/k1/cmd (publicación on/off)
};

type DeviceConfig = {
  id: string;                   // d_000
  model: string;                // mod_1x1
  lwtTopic: string;             // mod_1x1/d_000/lwt ("offline" via Last Will)
  heartbeatTopic: string;       // mod_1x1/d_000/hb (payload: epoch ms o "ping")
  programQueryTopic: string;    // .../programs/get
  programSetTopic: string;      // .../programs/set
  programDeleteTopic: string;   // .../programs/del
  relays: RelayConfig[];        // N relés según dispositivo
};

type UserProfile = {
  sub: string; // Cognito user id
  displayName: string;
};

type RelayState = {
  online: boolean | "unknown";           // estado de dispositivo
  lastHeartbeat?: number;                 // epoch ms
  rx: Record<string, boolean>;            // feedback por relé
  status: Record<string, boolean>;        // status por relé
  names: Record<string, string>;          // nombres personalizados por relé
};

// Registro acción + nota
interface ActionLogEntry {
  ts: number;              // epoch ms
  deviceId: string;
  relay: RelayKey;
  action: "on" | "off" | "status" | "feedback" | "program";
  note?: string;
}

// Datos timeline: rangos on/off por relé
interface RelayInterval { relay: RelayKey; start: number; end: number | null; /* null = aún activo */ }

// -------------------- Interfaz MQTT (genérica) --------------------

interface IMqttClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  publish(topic: string, payload: string): Promise<void>;
  subscribe(topic: string, cb: (topic: string, payload: string) => void): Promise<void>;
  unsubscribe(topic: string): Promise<void>;
}

// MOCK opcional para desarrollo local sin backend
class MockMqttClient implements IMqttClient {
  private subs = new Map<string, (t: string, p: string)=>void>();
  private interval?: number;
  async connect(){
    // Emitir heartbeat cada 10s
    this.interval = window.setInterval(()=>{
      const t = "mod_1x1/d_000/hb";
      this.emit(t, String(Date.now()));
    }, 10000);
  }
  async disconnect(){ if (this.interval) window.clearInterval(this.interval); this.subs.clear(); }
  async publish(topic: string, payload: string){
    // Simular eco en feedback/status
    setTimeout(()=>{
      if (topic.endsWith("/cmd")){
        const base = topic.replace(/\/cmd$/, "");
        this.emit(base+"/feedback", payload);
        this.emit(base+"/status", payload);
      }
      if (topic.endsWith("/programs/get")){
        this.emit(topic.replace(/get$/, "list"), JSON.stringify([
          { id: "p1", code: "rl:07_00_30m", desc: "Riego lunes 7:00-7:30" }
        ]));
      }
      if (topic.endsWith("/programs/set")){
        this.emit(topic.replace(/set$/, "ack"), payload);
      }
      if (topic.endsWith("/programs/del")){
        this.emit(topic.replace(/del$/, "ack"), payload);
      }
    }, 300);
  }
  async subscribe(topic: string, cb: (t: string,p:string)=>void){ this.subs.set(topic, cb); }
  async unsubscribe(topic: string){ this.subs.delete(topic); }
  private emit(topic: string, payload: string){ this.subs.forEach((cb, t)=>{ if (t===topic) cb(topic, payload); }); }
}

// -------------------- Stubs Cognito / carga de dispositivos --------------------

async function getUser(): Promise<UserProfile> {
  // Sustituir por AWS Amplify Auth.CurrentAuthenticatedUser() o SDK Cognito Identity
  return { sub: "user-123", displayName: "Francisco" };
}

async function getUserDevices(userSub: string): Promise<DeviceConfig[]> {
  // Sustituir por tu API (API Gateway + Lambda) que devuelva dispositivos asignados al usuario
  return [
    {
      id: "d_000",
      model: "mod_1x1",
      lwtTopic: "mod_1x1/d_000/lwt",
      heartbeatTopic: "mod_1x1/d_000/hb",
      programQueryTopic: "mod_1x1/d_000/programs/get",
      programSetTopic: "mod_1x1/d_000/programs/set",
      programDeleteTopic: "mod_1x1/d_000/programs/del",
      relays: [1,2,3,4].map(i => ({
        key: `k${i}`,
        name: `Relé ${i}`,
        statusTopic: `mod_1x1/d_000/k${i}/status`,
        feedbackTopic: `mod_1x1/d_000/k${i}/feedback`,
        cmdTopic: `mod_1x1/d_000/k${i}/cmd`,
      }))
    }
  ];
}

// -------------------- Hook de MQTT con gestión de vida --------------------

function useMqtt(device: DeviceConfig | null) {
  const clientRef = useRef<IMqttClient | null>(null);
  const [connected, setConnected] = useState(false);

  const connect = useCallback(async ()=>{
    if (!device) return;
    if (!clientRef.current) clientRef.current = new MockMqttClient(); // Reemplaza por cliente real (mqtt.js)
    await clientRef.current.connect();
    setConnected(true);
  }, [device]);

  const disconnect = useCallback(async ()=>{
    if (clientRef.current){ await clientRef.current.disconnect(); setConnected(false); }
  }, []);

  const publish = useCallback(async (topic: string, payload: string)=>{
    if (!clientRef.current) throw new Error("MQTT no conectado");
    return clientRef.current.publish(topic, payload);
  }, []);

  const subscribe = useCallback(async (topic: string, cb: (t:string,p:string)=>void)=>{
    if (!clientRef.current) throw new Error("MQTT no conectado");
    return clientRef.current.subscribe(topic, cb);
  }, []);

  const unsubscribe = useCallback(async (topic: string)=>{
    if (!clientRef.current) throw new Error("MQTT no conectado");
    return clientRef.current.unsubscribe(topic);
  }, []);

  return { connected, connect, disconnect, publish, subscribe, unsubscribe };
}

// -------------------- Utilidades --------------------

const ms = (s:number)=> s*1000;

function formatTime(ts:number){ const d = new Date(ts); return d.toLocaleString(); }

function clsx(...xs: Array<string | false | undefined>) { return xs.filter(Boolean).join(" "); }

// -------------------- Componente principal --------------------

export default function IoTDashboard() {
  const { toast } = useToast();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [devices, setDevices] = useState<DeviceConfig[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const selectedDevice = useMemo(()=> devices.find(d=>d.id===selectedDeviceId) ?? null, [devices, selectedDeviceId]);

  const { connected, connect, disconnect, publish, subscribe } = useMqtt(selectedDevice);

  // Estado por dispositivo
  const [state, setState] = useState<RelayState>({ online: "unknown", rx: {}, status: {}, names: {} });
  const [intervals, setIntervals] = useState<RelayInterval[]>([]);
  const [log, setLog] = useState<ActionLogEntry[]>([]);

  // Inactividad → auto logout/desconexión
  useEffect(()=>{
    let timer: number | undefined;
    const bump = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(async ()=>{
        await disconnect();
        setSelectedDeviceId(null);
        toast({ title: "Sesión inactiva", description: "Se ha cerrado la conexión MQTT por inactividad." });
      }, ms(15*60)); // 15 min
    };
    const events = ["click","keydown","mousemove","touchstart"];
    events.forEach(e=>window.addEventListener(e, bump));
    bump();
    return ()=>{ if (timer) window.clearTimeout(timer); events.forEach(e=>window.removeEventListener(e, bump)); };
  }, [disconnect, toast]);

  // Carga de usuario + dispositivos
  useEffect(()=>{ (async()=>{
    const u = await getUser(); setUser(u);
    const ds = await getUserDevices(u.sub); setDevices(ds); setSelectedDeviceId(ds[0]?.id ?? null);
  })(); }, []);

  // Suscripciones MQTT cuando hay dispositivo seleccionado
  useEffect(()=>{
    if (!selectedDevice) return;
    (async()=>{
      await connect();

      // Nombres iniciales (personalizables)
      setState(prev=>({ ...prev, names: Object.fromEntries(selectedDevice.relays.map(r=>[r.key, r.name])) }));

      // Heartbeat + LWT → estado online
      await subscribe(selectedDevice.heartbeatTopic, (_t,p)=>{
        const now = Number(p) || Date.now();
        setState(prev=>({ ...prev, online: true, lastHeartbeat: now }));
      });
      await subscribe(selectedDevice.lwtTopic, (_t,p)=>{
        if (p.toLowerCase().includes("offline")) setState(prev=>({ ...prev, online: false }));
      });

      // Status/Feedback por cada relé
      for (const r of selectedDevice.relays){
        await subscribe(r.statusTopic, (_t,p)=>{
          const on = /on|1|true/i.test(p);
          setState(prev=>({ ...prev, status: { ...prev.status, [r.key]: on }}));
          setLog(prev=>[{ ts: Date.now(), deviceId: selectedDevice.id, relay: r.key, action: "status" }, ...prev]);
          setIntervals(prev=>updateIntervals(prev, r.key, on));
        });
        await subscribe(r.feedbackTopic, (_t,p)=>{
          const on = /on|1|true/i.test(p);
          setState(prev=>({ ...prev, rx: { ...prev.rx, [r.key]: on }}));
          setLog(prev=>[{ ts: Date.now(), deviceId: selectedDevice.id, relay: r.key, action: "feedback" }, ...prev]);
        });
      }
    })();

    return ()=>{ disconnect(); };
  }, [selectedDevice, connect, subscribe, disconnect]);

  // Watchdog de heartbeat: si pasa demasiado, marcar offline
  useEffect(()=>{
    const id = window.setInterval(()=>{
      setState(prev=>{
        if (!prev.lastHeartbeat) return prev;
        const tooOld = Date.now() - prev.lastHeartbeat > ms(35); // si hb cada 15-20s → 35s ya es fuera
        if (tooOld && prev.online !== false) return { ...prev, online: false };
        return prev;
      });
    }, 5000);
    return ()=> window.clearInterval(id);
  }, []);

  // Accionar relé (con confirmación y nota opcional)
  const [pendingAction, setPendingAction] = useState<{relay: RelayConfig, turnOn: boolean} | null>(null);
  const [note, setNote] = useState("");

  const doAction = useCallback(async ()=>{
    if (!pendingAction || !selectedDevice) return;
    const { relay, turnOn } = pendingAction;
    const payload = turnOn ? "on" : "off";
    await publish(relay.cmdTopic, payload);
    setLog(prev=>[{ ts: Date.now(), deviceId: selectedDevice.id, relay: relay.key, action: payload as any, note: note || undefined }, ...prev]);
    setNote("");
    setPendingAction(null);
    toast({ title: `Comando enviado`, description: `${relay.name}: ${payload.toUpperCase()}` });
  }, [pendingAction, publish, selectedDevice, note, toast]);

  // Programas
  const [programCode, setProgramCode] = useState("");
  const [programList, setProgramList] = useState<Array<{id:string, code:string, desc?:string}>>([]);

  const queryPrograms = useCallback(async ()=>{
    if (!selectedDevice) return;
    await publish(selectedDevice.programQueryTopic, "get");
    // En integración real: suscríbete a .../programs/list y setProgramList desde payload
  }, [publish, selectedDevice]);

  const addProgram = useCallback(async ()=>{
    if (!selectedDevice || !programCode.trim()) return;
    await publish(selectedDevice.programSetTopic, programCode.trim());
    setProgramCode("");
    toast({ title: "Programa enviado", description: programCode });
  }, [publish, selectedDevice, programCode, toast]);

  const delProgram = useCallback(async (id:string)=>{
    if (!selectedDevice) return;
    await publish(selectedDevice.programDeleteTopic, id);
    toast({ title: "Programa eliminado", description: id });
  }, [publish, selectedDevice, toast]);

  // Render helpers
  const onlineBadge = state.online === true
    ? <Badge className="bg-green-600">Online</Badge>
    : state.online === false
      ? <Badge className="bg-zinc-500">Offline</Badge>
      : <Badge className="bg-amber-600">Desconocido</Badge>;

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
      <Toaster />
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Panel IoT</h1>
          <p className="text-sm text-zinc-500">Hola {user?.displayName ?? "—"}</p>
        </div>
        <div className="flex items-center gap-3">
          <Activity className="w-5 h-5" /> {onlineBadge}
          {state.lastHeartbeat && (
            <span className="text-xs text-zinc-500">HB: {formatTime(state.lastHeartbeat)}</span>
          )}
          <Button variant="secondary" onClick={disconnect}><LogOut className="w-4 h-4 mr-2"/>Desconectar</Button>
        </div>
      </header>

      {/* Selector de dispositivo (según usuario/Cognito) */}
      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle>Dispositivo</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3 items-center">
          <Label htmlFor="dev">Selecciona</Label>
          <select id="dev" className="border rounded-lg px-3 py-2" value={selectedDeviceId ?? ""} onChange={e=>setSelectedDeviceId(e.target.value)}>
            {devices.map(d=> <option key={d.id} value={d.id}>{d.model} / {d.id}</option>)}
          </select>
          <Button onClick={queryPrograms} variant="outline"><ListChecks className="w-4 h-4 mr-2"/>Ver programas</Button>
        </CardContent>
      </Card>

      {/* Filas por relé */}
      {selectedDevice && (
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle>Relés</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {selectedDevice.relays.map(relay=>{
              const on = !!state.status[relay.key];
              const rx = state.rx[relay.key];
              const name = state.names[relay.key] ?? relay.name;
              return (
                <div key={relay.key} className="grid grid-cols-12 items-center gap-3 p-3 rounded-xl border">
                  {/* Nombre editable */}
                  <div className="col-span-3 flex items-center gap-2">
                    <Input value={name} onChange={e=> setState(prev=>({ ...prev, names: { ...prev.names, [relay.key]: e.target.value }}))} />
                    <Pencil className="w-4 h-4 text-zinc-500"/>
                  </div>

                  {/* Toggle on/off con confirmación */}
                  <div className="col-span-3 flex items-center gap-2">
                    <Switch checked={on} onCheckedChange={(checked)=> setPendingAction({ relay, turnOn: checked })} />
                    <span className={clsx("text-sm px-2 py-1 rounded-md", on ? "bg-red-600 text-white" : "bg-zinc-200 text-zinc-800")}>{on ? "Encendido" : "Apagado"}</span>
                  </div>

                  {/* Rx signal (feedback) */}
                  <div className="col-span-3 flex items-center gap-2">
                    <Signal className={clsx("w-5 h-5", rx ? "text-red-600" : "text-zinc-400")} />
                    <span className="text-sm">Rx</span>
                    {rx ? <CheckCircle2 className="w-4 h-4 text-red-600"/> : <XCircle className="w-4 h-4 text-zinc-400"/>}
                  </div>

                  {/* Status */}
                  <div className="col-span-3 flex items-center gap-2">
                    <Power className={clsx("w-5 h-5", on ? "text-red-600" : "text-zinc-400")} />
                    <span className="text-sm">Status</span>
                    {on ? <CheckCircle2 className="w-4 h-4 text-red-600"/> : <XCircle className="w-4 h-4 text-zinc-400"/>}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Timeline multi‑relé + notas */}
      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle>Histórico (timeline)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={buildTimelineData(intervals)} margin={{ left: 20, right: 20, top: 10, bottom: 10 }}>
                <XAxis dataKey="time" tickFormatter={(v)=> new Date(v).toLocaleTimeString()} type="number" domain={["dataMin", "dataMax"]} />
                <YAxis dataKey="relay" type="category" width={60} />
                <Tooltip formatter={(v:any, n:any, p:any)=> n==="label" ? v : (v?"ON":"OFF")} labelFormatter={(l)=> new Date(Number(l)).toLocaleString()} />
                {/* Pintamos barras (0/1) superpuestas por relé */}
                <Bar dataKey="k1" stackId="k1" barSize={8} />
                <Bar dataKey="k2" stackId="k2" barSize={8} />
                <Bar dataKey="k3" stackId="k3" barSize={8} />
                <Bar dataKey="k4" stackId="k4" barSize={8} />
                <ReferenceLine x={Date.now()} strokeDasharray="3 3" label="Ahora" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
        <CardFooter className="flex-col items-stretch gap-3">
          <Label>Nota rápida (se adjunta a la próxima acción)</Label>
          <Input placeholder="Ej: Riego sector 3 con abonado A" value={note} onChange={e=>setNote(e.target.value)} />
          <ActionLog log={log} />
        </CardFooter>
      </Card>

      {/* Programas */}
      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle>Programas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Input placeholder="Ej: rl:07_00_30m" value={programCode} onChange={e=>setProgramCode(e.target.value)} />
            <Button onClick={addProgram}><Clock className="w-4 h-4 mr-2"/>Añadir</Button>
            <Button variant="outline" onClick={queryPrograms}><ListChecks className="w-4 h-4 mr-2"/>Refrescar</Button>
          </div>
          <Separator />
          {programList.length===0 ? (
            <p className="text-sm text-zinc-500">No hay programas listados. (Conecta la suscripción .../programs/list)</p>
          ) : (
            <ul className="space-y-2">
              {programList.map(p => (
                <li key={p.id} className="flex items-center justify-between border rounded-lg p-2">
                  <div className="text-sm"><b>{p.id}</b> – {p.code} {p.desc && <span className="text-zinc-500">({p.desc})</span>}</div>
                  <Button variant="destructive" onClick={()=>delProgram(p.id)}>Borrar</Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Diálogo de confirmación */}
      <Dialog open={!!pendingAction} onOpenChange={(o)=>{ if (!o) setPendingAction(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar acción</DialogTitle>
            <DialogDescription>
              ¿Seguro que quieres {pendingAction?.turnOn ? "encender" : "apagar"} {pendingAction ? (state.names[pendingAction.relay.key] ?? pendingAction.relay.name) : ""}?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={()=>setPendingAction(null)}>Cancelar</Button>
            <Button onClick={doAction}>{pendingAction?.turnOn ? "Encender" : "Apagar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// -------------------- Subcomponentes --------------------

function ActionLog({ log }: { log: ActionLogEntry[] }){
  return (
    <div className="mt-2 border rounded-xl p-3 max-h-56 overflow-auto">
      <h3 className="font-semibold mb-2 text-sm">Registro</h3>
      <ul className="space-y-1">
        {log.map((e,i)=>(
          <li key={i} className="text-xs text-zinc-600">
            <span className="font-mono">{new Date(e.ts).toLocaleString()}</span> · {e.deviceId} · {e.relay} · {e.action.toUpperCase()} {e.note && <em>— {e.note}</em>}
          </li>
        ))}
      </ul>
    </div>
  )
}

// -------------------- Timeline helpers --------------------

function updateIntervals(curr: RelayInterval[], relay: RelayKey, turnedOn: boolean): RelayInterval[] {
  const now = Date.now();
  const open = curr.find(it=> it.relay===relay && it.end===null);
  if (turnedOn){
    // si ya hay uno abierto, no duplicar
    if (open) return curr;
    return [{ relay, start: now, end: null }, ...curr];
  } else {
    // cerrar si hay abierto
    if (!open) return curr; 
    return curr.map(it=> it===open ? { ...it, end: now } : it);
  }
}

function buildTimelineData(intervals: RelayInterval[]){
  // Convertimos a puntos para recharts. Para simplificar, muestreamos cortes de tiempo.
  const relays = ["k1","k2","k3","k4"]; // puedes derivarlo dinámicamente del device
  const times: number[] = [];
  intervals.forEach(iv=>{ times.push(iv.start); if (iv.end) times.push(iv.end); });
  if (times.length===0) return [] as any[];
  times.sort((a,b)=>a-b);
  // Añade ahora para referencia
  times.push(Date.now());

  const rows = times.map(t=>{
    const row: any = { time: t };
    for (const r of relays){
      const active = intervals.some(iv=> iv.relay===r && iv.start<=t && (iv.end===null || iv.end>=t));
      row[r] = active ? 1 : 0;
    }
    return row;
  });
  return rows;
}
