import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Music, Calendar, MapPin, Clock, Users, Plus, X, Check, HelpCircle, Lock, Unlock,
  Trash2, Pencil, ListMusic, Link as LinkIcon, ArrowLeft, Home, FolderOpen,
  ArrowUpCircle, ArrowDownCircle, Megaphone, ChevronRight, FileText,
  Headphones, Video, Paperclip, Star, CalendarDays, LogOut, Copy, ChevronDown, UserPlus,
  MessageCircle, Mail,
} from "lucide-react";
import {
  supabase, kvGet, kvSet, signInWithGoogle, signOut,
  createTeam, joinTeamByCode, getUserTeams, saveUserTeams,
} from "./supabaseClient";

const FONTS = `@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;0,9..144,700;1,9..144,500&family=Work+Sans:wght@400;500;600;700&display=swap');`;

const uid = () => Math.random().toString(36).slice(2, 10);
const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const EVENT_TYPES = [
  { id: "servicio", label: "Servicio", color: "#E4B75B" },
  { id: "ensayo", label: "Ensayo", color: "#7C93C7" },
  { id: "reunion", label: "Reunión", color: "#8C3B4A" },
];
const RESOURCE_TYPES = [
  { id: "partitura", label: "Partitura", icon: FileText },
  { id: "pdf", label: "PDF", icon: FileText },
  { id: "audio", label: "Audio", icon: Headphones },
  { id: "video", label: "Video", icon: Video },
  { id: "otro", label: "Otro", icon: Paperclip },
];

function typeInfo(id) { return EVENT_TYPES.find((t) => t.id === id) || EVENT_TYPES[0]; }
function fmtDate(iso) { if (!iso) return ""; return new Date(iso + "T00:00:00").toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" }); }
function fmtDateShort(iso) { if (!iso) return ""; return new Date(iso + "T00:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "short" }); }

// ---------- transposición de acordes entre corchetes: [G] [Am7] [D/F#] ----------
const CHROMA_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const ENH = { Db: "C#", Eb: "D#", Gb: "F#", Ab: "G#", Bb: "A#" };
function noteIndex(n) { const norm = ENH[n] || n; return CHROMA_SHARP.indexOf(norm); }
function shiftNote(n, steps) { const i = noteIndex(n); if (i === -1) return n; return CHROMA_SHARP[(i + steps + 120) % 12]; }
function transposeChordToken(token, steps) {
  const m = token.match(/^([A-G](?:#|b)?)([^/]*)(?:\/([A-G](?:#|b)?))?$/);
  if (!m) return token;
  const [, root, rest, bass] = m;
  const newRoot = shiftNote(root, steps);
  const newBass = bass ? shiftNote(bass, steps) : "";
  return newRoot + rest + (bass ? "/" + newBass : "");
}
function transposeLyrics(text, steps) {
  if (!steps || !text) return text;
  return text.replace(/\[([^\]]+)\]/g, (_, chord) => `[${transposeChordToken(chord, steps)}]`);
}
function renderChordLine(text) {
  const parts = text.split(/(\[[^\]]+\])/g);
  return parts.map((p, i) => {
    const m = p.match(/^\[([^\]]+)\]$/);
    if (m) return <b key={i} className="chord">{m[1]}</b>;
    return <React.Fragment key={i}>{p}</React.Fragment>;
  });
}

// separa una línea "[G]Sublime [C]gracia" en una fila de acordes y una de
// letra, con cada acorde posicionado arriba de d.nde va (estilo OnStage)
function splitChordLine(text) {
  let lyrics = "";
  let chords = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "[") {
      const end = text.indexOf("]", i);
      if (end === -1) { lyrics += text[i]; i++; continue; }
      const chord = text.slice(i + 1, end);
      while (chords.length < lyrics.length) chords += " ";
      chords += chord;
      i = end + 1;
    } else {
      lyrics += text[i];
      i++;
    }
  }
  return { chords, lyrics };
}

// presets de secciones típicas (abreviatura + color), como en OnStage
const SECTION_PRESETS = [
  { match: ["intro"], abbr: "IN", color: "#8FB88F" },
  { match: ["estrofa", "verso"], abbr: "V", color: "#7EA6D9" },
  { match: ["preestribillo", "pre-coro", "precoro", "pre estribillo"], abbr: "PC", color: "#D98FD9" },
  { match: ["coro", "estribillo"], abbr: "C", color: "#E4A15B" },
  { match: ["interludio"], abbr: "INT", color: "#8FD9C9" },
  { match: ["puente", "bridge"], abbr: "P", color: "#9D9FE4" },
  { match: ["final", "outro", "salida"], abbr: "F", color: "#C9C9C9" },
];
function sectionMeta(name) {
  const lower = (name || "").toLowerCase().trim();
  for (const p of SECTION_PRESETS) if (p.match.some((m) => lower.startsWith(m))) return p;
  const abbr = (name || "??").trim().slice(0, 2).toUpperCase() || "??";
  return { abbr, color: "#9aa2c9" };
}


function useShared(key, fallback, enabled = true) {
  const [val, setVal] = useState(fallback);
  const [loaded, setLoaded] = useState(!enabled);
  useEffect(() => {
    if (!enabled) { setVal(fallback); setLoaded(false); return; }
    let cancelled = false;
    (async () => {
      try { const r = await kvGet(key); if (!cancelled) setVal(r !== null && r !== undefined ? r : fallback); }
      catch (e) { console.error(e); if (!cancelled) setVal(fallback); }
      if (!cancelled) setLoaded(true);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [key, enabled]);
  const save = useCallback(async (next) => {
    setVal(next);
    if (!enabled) return;
    try { await kvSet(key, next); } catch (e) { console.error(e); }
    // eslint-disable-next-line
  }, [key, enabled]);
  return [val, save, loaded];
}

export default function Afina() {
  // ---------- sesión (Google) ----------
  const [session, setSession] = useState(undefined); // undefined = cargando, null = sin sesión
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);
  const user = session?.user || null;
  const me = user ? (user.user_metadata?.full_name || user.user_metadata?.name || user.email || "Sin nombre") : "";

  // ---------- equipos del usuario ----------
  const [myTeams, setMyTeams] = useState(null); // null = cargando
  const [currentTeamId, setCurrentTeamId] = useState(() => { try { return localStorage.getItem("afina_team_id") || null; } catch { return null; } });
  const [teamErr, setTeamErr] = useState("");

  useEffect(() => {
    if (!user) { setMyTeams(null); return; }
    (async () => {
      try {
        const teams = await getUserTeams(user.id);
        setMyTeams(teams);
        if (!currentTeamId && teams.length === 1) selectTeam(teams[0].id);
      } catch (e) { console.error(e); setMyTeams([]); }
    })();
    // eslint-disable-next-line
  }, [user]);

  function selectTeam(id) {
    setCurrentTeamId(id);
    try { localStorage.setItem("afina_team_id", id); } catch {}
  }
  function switchTeam() {
    setCurrentTeamId(null);
    try { localStorage.removeItem("afina_team_id"); } catch {}
  }
  async function handleCreateTeam(name) {
    setTeamErr("");
    try {
      const team = await createTeam(name);
      const next = [...(myTeams || []), team];
      await saveUserTeams(user.id, next);
      setMyTeams(next);
      selectTeam(team.id);
    } catch (e) { console.error(e); setTeamErr("No se pudo crear el equipo. Probá de nuevo."); }
  }
  async function handleJoinTeam(code) {
    setTeamErr("");
    try {
      const clean = code.trim().toUpperCase();
      const found = await joinTeamByCode(clean);
      if (!found) { setTeamErr("Ese código no existe. Revisalo con quien te lo pasó."); return; }
      const already = (myTeams || []).some((t) => t.id === found.id);
      const next = already ? myTeams : [...(myTeams || []), { ...found, code: clean }];
      if (!already) { await saveUserTeams(user.id, next); setMyTeams(next); }
      selectTeam(found.id);
    } catch (e) { console.error(e); setTeamErr("No se pudo unir al equipo. Probá de nuevo."); }
  }
  async function handleSignOut() { await signOut(); switchTeam(); }

  const currentTeam = (myTeams || []).find((t) => t.id === currentTeamId) || null;
  const tk = currentTeamId;
  const teamReady = !!tk;
  const tkey = (name) => `team:${tk}:${name}`;

  // ---------- datos del equipo (solo se cargan cuando hay equipo elegido) ----------
  const [events, setEvents] = useShared(tk ? tkey("events") : "noop:events", [], teamReady);
  const [songs, setSongs] = useShared(tk ? tkey("songs") : "noop:songs", [], teamReady);
  const [members, setMembers] = useShared(tk ? tkey("members") : "noop:members", [], teamReady);
  const [avisos, setAvisos] = useShared(tk ? tkey("avisos") : "noop:avisos", [], teamReady);
  const [resources, setResources] = useShared(tk ? tkey("resources") : "noop:resources", [], teamReady);
  const [config, setConfig, configLoaded] = useShared(tk ? tkey("config") : "noop:config", { pin: "1234" }, teamReady);
  const [attendance, setAttendance] = useState({});

  const [isAdmin, setIsAdmin] = useState(false);
  const [tab, setTab] = useState("inicio");
  const [screen, setScreen] = useState({ mode: "list", id: null });
  const [modal, setModal] = useState(null);
  const [err, setErr] = useState("");

  const loading = teamReady && !configLoaded;

  useEffect(() => { setScreen({ mode: "list", id: null }); }, [tab]);
  useEffect(() => { setIsAdmin(false); setTab("inicio"); }, [tk]);

  const loadAttendance = useCallback(async (eventId) => {
    if (!tk) return;
    try { const r = await kvGet(tkey("attendance:" + eventId)); setAttendance((p) => ({ ...p, [eventId]: r || {} })); }
    catch (e) { console.error(e); setAttendance((p) => ({ ...p, [eventId]: {} })); }
    // eslint-disable-next-line
  }, [tk]);
  async function saveAttendance(eventId, next) {
    setAttendance((p) => ({ ...p, [eventId]: next }));
    try { await kvSet(tkey("attendance:" + eventId), next); } catch (e) { console.error(e); setErr("No se pudo guardar tu respuesta."); }
  }
  useEffect(() => {
    if (!teamReady) return;
    events.forEach((e) => { if (!(e.id in attendance)) loadAttendance(e.id); });
    // eslint-disable-next-line
  }, [events, teamReady]);

  function requireMe(after) { after(me); }
  function tryAdmin() {
    if (isAdmin) { setIsAdmin(false); return; }
    setModal("pin");
  }

  const today = new Date().toISOString().slice(0, 10);
  const sortedEvents = useMemo(() => [...events].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)), [events]);
  const proximoEvento = sortedEvents.find((e) => e.date >= today);

  async function upsertEvent(data) {
    if (data.id) await setEvents(events.map((e) => (e.id === data.id ? data : e)));
    else await setEvents([...events, { ...data, id: uid() }]);
    setScreen({ mode: "list", id: null });
  }
  async function deleteEvent(id) {
    if (!window.confirm("¿Borrar este evento?")) return;
    await setEvents(events.filter((e) => e.id !== id));
    setScreen({ mode: "list", id: null });
  }
  async function setMyAttendance(eventId, status) {
    requireMe(async (name) => {
      const cur = attendance[eventId] || {};
      await saveAttendance(eventId, { ...cur, [name]: status });
    });
  }
  async function claimRole(eventId, roleId) {
    requireMe(async (name) => {
      const ev = events.find((e) => e.id === eventId);
      const roles = ev.roles.map((r) => (r.id === roleId ? { ...r, assignedTo: r.assignedTo === name ? "" : name } : r));
      await setEvents(events.map((e) => (e.id === eventId ? { ...e, roles } : e)));
    });
  }
  async function assignRole(eventId, roleId, name) {
    const ev = events.find((e) => e.id === eventId);
    const roles = ev.roles.map((r) => (r.id === roleId ? { ...r, assignedTo: name } : r));
    await setEvents(events.map((e) => (e.id === eventId ? { ...e, roles } : e)));
  }

  async function upsertSong(data) {
    if (data.id) await setSongs(songs.map((s) => (s.id === data.id ? data : s)));
    else await setSongs([...songs, { ...data, id: uid() }]);
    setScreen({ mode: "list", id: null });
  }
  async function deleteSong(id) {
    if (!window.confirm("¿Borrar esta canción de la biblioteca?")) return;
    await setSongs(songs.filter((s) => s.id !== id));
    setScreen({ mode: "list", id: null });
  }

  async function upsertMember(data) {
    if (data.id) await setMembers(members.map((m) => (m.id === data.id ? data : m)));
    else await setMembers([...members, { ...data, id: uid() }]);
    setScreen({ mode: "list", id: null });
  }
  async function deleteMember(id) {
    if (!window.confirm("¿Quitar a esta persona del equipo?")) return;
    await setMembers(members.filter((m) => m.id !== id));
    setScreen({ mode: "list", id: null });
  }

  async function upsertResource(data) {
    if (data.id) await setResources(resources.map((r) => (r.id === data.id ? data : r)));
    else await setResources([...resources, { ...data, id: uid() }]);
    setScreen({ mode: "list", id: null });
  }
  async function deleteResource(id) { await setResources(resources.filter((r) => r.id !== id)); }

  async function addAviso(text) { await setAvisos([{ id: uid(), text, date: new Date().toISOString() }, ...avisos]); }
  async function removeAviso(id) { await setAvisos(avisos.filter((a) => a.id !== id)); }

  if (session === undefined || (user && myTeams === null) || loading) {
    return (
      <div className="afina-app"><style>{FONTS}</style><style>{CSS}</style>
        <div className="loading">Afinando los instrumentos…</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="afina-app"><style>{FONTS}</style><style>{CSS}</style>
        <LoginScreen onGoogle={signInWithGoogle} />
      </div>
    );
  }

  if (!currentTeamId) {
    return (
      <div className="afina-app"><style>{FONTS}</style><style>{CSS}</style>
        <TeamGate me={me} teams={myTeams || []} err={teamErr}
          onSelect={selectTeam} onCreate={handleCreateTeam} onJoin={handleJoinTeam} onSignOut={handleSignOut} />
      </div>
    );
  }

  return (
    <div className="afina-app">
      <style>{FONTS}</style>
      <style>{CSS}</style>

      <header className="header">
        <TeamMenu team={currentTeam} teams={myTeams} me={me} onSwitch={switchTeam} onSelect={selectTeam} onSignOut={handleSignOut} />
        <div className="header-actions">
          <button className="admin-btn ghost" onClick={() => setModal("help")}><HelpCircle size={15} /><span>Ayuda</span></button>
          <button className="admin-btn" onClick={tryAdmin}>{isAdmin ? <Unlock size={15} /> : <Lock size={15} />}<span>{isAdmin ? "Admin" : "Ingresar"}</span></button>
        </div>
      </header>

      {err && <div className="err-banner" onClick={() => setErr("")}>{err}</div>}

      <main className="main">
        {tab === "inicio" && (
          <Inicio
            proximoEvento={proximoEvento} attendance={attendance[proximoEvento?.id] || {}}
            me={me} members={members} songs={songs} avisos={avisos} isAdmin={isAdmin}
            onSetAttendance={(s) => proximoEvento && setMyAttendance(proximoEvento.id, s)}
            onGoEvent={() => { setTab("eventos"); setScreen({ mode: "detail", id: proximoEvento.id }); }}
            onAddAviso={addAviso} onRemoveAviso={removeAviso}
          />
        )}

        {tab === "eventos" && (
          <EventosTab
            events={sortedEvents} today={today} screen={screen} setScreen={setScreen} isAdmin={isAdmin}
            songs={songs} members={members} me={me} attendance={attendance}
            onSave={upsertEvent} onDelete={deleteEvent}
            onSetAttendance={setMyAttendance} onClaimRole={claimRole} onAssignRole={assignRole}
            requireMe={requireMe}
          />
        )}

        {tab === "canciones" && (
          <CancionesTab songs={songs} screen={screen} setScreen={setScreen} isAdmin={isAdmin} onSave={upsertSong} onDelete={deleteSong} />
        )}

        {tab === "equipo" && (
          <EquipoTab members={members} screen={screen} setScreen={setScreen} isAdmin={isAdmin} me={me}
            onSave={upsertMember} onDelete={deleteMember} requireMe={requireMe} />
        )}

        {tab === "recursos" && (
          <RecursosTab resources={resources} screen={screen} setScreen={setScreen} isAdmin={isAdmin} onSave={upsertResource} onDelete={deleteResource} />
        )}
      </main>

      <footer className="app-footer">Hugo H. Pacheco</footer>

      <nav className="bottom-nav">
        <NavBtn icon={Home} label="Inicio" active={tab === "inicio"} onClick={() => setTab("inicio")} />
        <NavBtn icon={CalendarDays} label="Eventos" active={tab === "eventos"} onClick={() => setTab("eventos")} />
        <NavBtn icon={ListMusic} label="Canciones" active={tab === "canciones"} onClick={() => setTab("canciones")} />
        <NavBtn icon={Users} label="Equipo" active={tab === "equipo"} onClick={() => setTab("equipo")} />
        <NavBtn icon={FolderOpen} label="Recursos" active={tab === "recursos"} onClick={() => setTab("recursos")} />
      </nav>

      {modal === "pin" && (
        <Modal onClose={() => setModal(null)}>
          <h3 className="modal-title">Modo administrador</h3>
          <p className="modal-sub">Ingresá el PIN para crear y editar contenido.</p>
          <PinForm config={config} onOk={() => { setIsAdmin(true); setModal(null); }} onSaveConfig={setConfig} isAdmin={isAdmin} />
        </Modal>
      )}

      {modal === "help" && (
        <Modal onClose={() => setModal(null)}>
          <h3 className="modal-title">Ayuda y contacto</h3>
          <p className="modal-sub">¿Tenés una duda o encontraste algo que no funciona? Escribinos.</p>
          <div className="help-links">
            <a className="help-link" href="https://wa.me/5493525538427" target="_blank" rel="noreferrer">
              <MessageCircle size={16} /> WhatsApp
            </a>
            <a className="help-link" href="mailto:hugopachecofotografias@gmail.com">
              <Mail size={16} /> hugopachecofotografias@gmail.com
            </a>
          </div>
          <div className="help-author">Hecho por Hugo H. Pacheco</div>
        </Modal>
      )}
    </div>
  );
}

function NavBtn({ icon: Icon, label, active, onClick }) {
  return (
    <button className={"nav-btn" + (active ? " active" : "")} onClick={onClick}>
      <Icon size={20} /><span>{label}</span>
    </button>
  );
}

function Modal({ children, onClose }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}><X size={18} /></button>
        {children}
      </div>
    </div>
  );
}

function NameForm({ onSubmit }) {
  const [v, setV] = useState("");
  return (
    <>
      <input autoFocus className="input" placeholder="Tu nombre" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && v.trim() && onSubmit(v.trim())} />
      <button className="primary-btn" onClick={() => v.trim() && onSubmit(v.trim())}>Confirmar</button>
    </>
  );
}

function PinForm({ config, onOk, onSaveConfig, isAdmin }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [newPin, setNewPin] = useState("");
  return (
    <>
      <input autoFocus type="password" inputMode="numeric" className="input" placeholder="PIN" value={pin} onChange={(e) => setPin(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (pin === config.pin ? onOk() : setError("PIN incorrecto."))} />
      {error && <div className="pin-error">{error}</div>}
      <button className="primary-btn" onClick={() => (pin === config.pin ? onOk() : setError("PIN incorrecto."))}>Entrar</button>
      {isAdmin && (
        <div className="change-pin">
          <div className="label">Cambiar PIN</div>
          <div className="add-row">
            <input className="input" placeholder="Nuevo PIN" value={newPin} onChange={(e) => setNewPin(e.target.value)} />
            <button className="secondary-btn" onClick={() => { if (newPin.trim()) { onSaveConfig({ ...config, pin: newPin.trim() }); setNewPin(""); } }}>Guardar</button>
          </div>
        </div>
      )}
    </>
  );
}

function LoginScreen({ onGoogle }) {
  return (
    <div className="team-setup">
      <Music size={34} color="#E4B75B" />
      <h2>Afiná</h2>
      <p>Organizá los eventos y músicos de tu grupo. Iniciá sesión con tu cuenta de Google para empezar.</p>
      <button className="primary-btn" onClick={onGoogle}><Users size={16} /> Continuar con Google</button>
    </div>
  );
}

function TeamGate({ me, teams, err, onSelect, onCreate, onJoin, onSignOut }) {
  const [mode, setMode] = useState("create");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  return (
    <div className="team-setup">
      <Music size={34} color="#E4B75B" />
      <h2>Hola, {me.split(" ")[0]}</h2>

      {teams.length > 0 && (
        <>
          <p>Elegí tu equipo:</p>
          <div className="team-pick-list">
            {teams.map((t) => (
              <button key={t.id} className="team-pick-row" onClick={() => onSelect(t.id)}>
                <Music size={15} color="#E4B75B" /> {t.name}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="team-gate-tabs">
        <button className={"tab" + (mode === "create" ? " active" : "")} onClick={() => setMode("create")}><Plus size={13} /> Crear equipo</button>
        <button className={"tab" + (mode === "join" ? " active" : "")} onClick={() => setMode("join")}><UserPlus size={13} /> Unirme con código</button>
      </div>

      {mode === "create" && (
        <>
          <p>Ponele un nombre a tu grupo de alabanza o ministerio de música.</p>
          <input className="input" placeholder="Ej: Alabanza Central" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && onCreate(name.trim())} />
          <button className="primary-btn" onClick={() => name.trim() && onCreate(name.trim())}><Plus size={16} /> Crear equipo</button>
        </>
      )}
      {mode === "join" && (
        <>
          <p>Pedile a tu admin el código de invitación del equipo.</p>
          <input className="input" placeholder="Ej: A3F9K2" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && code.trim() && onJoin(code)} />
          <button className="primary-btn" onClick={() => code.trim() && onJoin(code)}><UserPlus size={16} /> Unirme</button>
        </>
      )}
      {err && <div className="pin-error">{err}</div>}

      <button className="secondary-btn" style={{ marginTop: 20 }} onClick={onSignOut}><LogOut size={14} /> Cerrar sesión</button>
    </div>
  );
}

function TeamMenu({ team, teams, me, onSwitch, onSelect, onSignOut }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  function copyCode() {
    try { navigator.clipboard.writeText(team.code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  }
  return (
    <div className="team-menu-wrap">
      <button className="brand" onClick={() => setOpen(!open)}>
        <Music size={21} color="#E4B75B" /><span>{team?.name || "Afiná"}</span><ChevronDown size={15} />
      </button>
      {open && (
        <div className="team-menu-dropdown" onMouseLeave={() => setOpen(false)}>
          <div className="team-menu-section">
            <div className="label">Código de invitación</div>
            <div className="team-code-row" onClick={copyCode}>
              <span>{team?.code}</span><Copy size={13} />
            </div>
            {copied && <div className="team-copied">¡Copiado!</div>}
          </div>
          {teams.length > 1 && (
            <div className="team-menu-section">
              <div className="label">Tus equipos</div>
              {teams.map((t) => (
                <button key={t.id} className="team-menu-item" onClick={() => { onSelect(t.id); setOpen(false); }}>{t.name}</button>
              ))}
            </div>
          )}
          <button className="team-menu-item" onClick={onSwitch}><Plus size={14} /> Crear o unirme a otro equipo</button>
          <button className="team-menu-item" onClick={onSignOut}><LogOut size={14} /> Cerrar sesión ({me.split(" ")[0]})</button>
        </div>
      )}
    </div>
  );
}

function Inicio({ proximoEvento, attendance, me, members, songs, avisos, isAdmin, onSetAttendance, onGoEvent, onAddAviso, onRemoveAviso }) {
  const myStatus = attendance[me];
  const myAvail = members.find((m) => m.name === me);
  const [avisoDraft, setAvisoDraft] = useState("");

  const songsToPrep = useMemo(() => {
    if (!proximoEvento) return [];
    return (proximoEvento.setlist || []).map((s) => {
      const song = songs.find((sg) => sg.id === s.songId);
      return { ...s, title: song?.title || s.title, key: s.key || song?.key };
    });
  }, [proximoEvento, songs]);

  return (
    <div>
      {proximoEvento ? (
        <div className="card featured" onClick={onGoEvent}>
          <div className="featured-head" style={{ background: typeInfo(proximoEvento.type).color + "22" }}>
            <Star size={16} color={typeInfo(proximoEvento.type).color} /><span>Próximo evento</span>
          </div>
          <div className="featured-body">
            <h3>{proximoEvento.title}</h3>
            <div className="meta"><Calendar size={13} /> {fmtDate(proximoEvento.date)} {proximoEvento.time && <>· <Clock size={12} /> {proximoEvento.time}</>}</div>
            {proximoEvento.location && <div className="meta"><MapPin size={13} /> {proximoEvento.location}</div>}
            <div className="att-btns" onClick={(e) => e.stopPropagation()}>
              <button className={"att-yes" + (myStatus === "si" ? " active" : "")} onClick={() => onSetAttendance("si")}><Check size={14} /> Voy</button>
              <button className={"att-maybe" + (myStatus === "tal-vez" ? " active" : "")} onClick={() => onSetAttendance("tal-vez")}><HelpCircle size={14} /> Tal vez</button>
              <button className={"att-no" + (myStatus === "no" ? " active" : "")} onClick={() => onSetAttendance("no")}><X size={14} /> No voy</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="empty small"><Calendar size={22} color="#5b628f" /><p>No hay próximos eventos cargados.</p></div>
      )}

      <Section title="Tu disponibilidad" icon={<CalendarDays size={16} />}>
        {myAvail ? (
          <div className="avail-row">{DAYS.map((d, i) => <span key={d} className={"avail-day" + (myAvail.availability?.[i] ? " on" : "")}>{d}</span>)}</div>
        ) : (
          <p className="muted">Todavía no cargaste tu disponibilidad. Andá a la sección Equipo y sumate.</p>
        )}
      </Section>

      {proximoEvento && songsToPrep.length > 0 && (
        <Section title="Canciones que tenés que preparar" icon={<ListMusic size={16} />}>
          <div className="prep-list">
            {songsToPrep.map((s) => (
              <div key={s.id} className="prep-item">
                <span className="prep-title">{s.title}</span>
                {s.key && <span className="prep-key">{s.key}</span>}
                {s.prepare && <span className="prep-flag">A sacar</span>}
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Avisos" icon={<Megaphone size={16} />}>
        {isAdmin && (
          <div className="add-row" style={{ marginBottom: 10 }}>
            <input className="input" placeholder="Escribir un aviso…" value={avisoDraft} onChange={(e) => setAvisoDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && avisoDraft.trim()) { onAddAviso(avisoDraft.trim()); setAvisoDraft(""); } }} />
            <button className="secondary-btn" onClick={() => { if (avisoDraft.trim()) { onAddAviso(avisoDraft.trim()); setAvisoDraft(""); } }}><Plus size={15} /></button>
          </div>
        )}
        {avisos.length === 0 && <p className="muted">No hay avisos por ahora.</p>}
        {avisos.slice(0, 5).map((a) => (
          <div key={a.id} className="aviso-row"><span>{a.text}</span>{isAdmin && <X size={13} className="clickable" onClick={() => onRemoveAviso(a.id)} />}</div>
        ))}
      </Section>
    </div>
  );
}

function Section({ title, icon, children }) {
  return (<div className="section"><div className="section-title">{icon} {title}</div>{children}</div>);
}

function EventosTab({ events, today, screen, setScreen, isAdmin, songs, members, me, attendance, onSave, onDelete, onSetAttendance, onClaimRole, onAssignRole, requireMe }) {
  const [subtab, setSubtab] = useState("proximos");
  const proximos = events.filter((e) => e.date >= today);
  const pasados = [...events].filter((e) => e.date < today).reverse();
  const shown = subtab === "proximos" ? proximos : pasados;

  if (screen.mode === "form") {
    const ev = screen.id ? events.find((e) => e.id === screen.id) : null;
    return <EventForm initial={ev} songs={songs} onCancel={() => setScreen({ mode: ev ? "detail" : "list", id: screen.id })} onSave={onSave} />;
  }
  if (screen.mode === "detail") {
    const ev = events.find((e) => e.id === screen.id);
    if (!ev) return null;
    return (
      <EventDetail ev={ev} songs={songs} members={members} isAdmin={isAdmin} me={me} attendance={attendance[ev.id] || {}}
        onBack={() => setScreen({ mode: "list", id: null })}
        onEdit={() => setScreen({ mode: "form", id: ev.id })}
        onDelete={() => onDelete(ev.id)}
        onSetAttendance={(s) => onSetAttendance(ev.id, s)}
        onClaimRole={(rid) => onClaimRole(ev.id, rid)}
        onAssignRole={(rid, name) => onAssignRole(ev.id, rid, name)}
        requireMe={requireMe}
      />
    );
  }

  return (
    <div>
      <div className="tabs">
        <button className={"tab" + (subtab === "proximos" ? " active" : "")} onClick={() => setSubtab("proximos")}>Próximos</button>
        <button className={"tab" + (subtab === "pasados" ? " active" : "")} onClick={() => setSubtab("pasados")}>Pasados</button>
      </div>
      {shown.length === 0 && (
        <div className="empty">
          <Calendar size={28} color="#5b628f" />
          <p>{subtab === "proximos" ? "No hay eventos cargados." : "No hay eventos pasados."}</p>
          {subtab === "proximos" && <button className="primary-btn" onClick={() => setScreen({ mode: "form", id: null })}><Plus size={16} /> Crear evento</button>}
        </div>
      )}
      <div className="grid">
        {shown.map((ev) => {
          const t = typeInfo(ev.type);
          const rolesOpen = (ev.roles || []).filter((r) => !r.assignedTo).length;
          const myStatus = (attendance[ev.id] || {})[me];
          return (
            <div key={ev.id} className="card event-card" onClick={() => setScreen({ mode: "detail", id: ev.id })}>
              <div className="clip" />
              <div className="card-header" style={{ background: t.color + "22", borderColor: t.color + "55" }}><Staff /></div>
              <div className="card-body">
                <span className="badge" style={{ background: t.color + "26", color: t.color, borderColor: t.color + "66" }}>{t.label}</span>
                <h3>{ev.title || "(Sin título)"}</h3>
                <div className="meta"><Calendar size={13} /> {fmtDateShort(ev.date)} {ev.time && <>· <Clock size={12} /> {ev.time}</>}</div>
                {ev.location && <div className="meta"><MapPin size={13} /> {ev.location}</div>}
                <div className="card-footer">
                  <span className="card-footer-item"><Users size={13} /> {rolesOpen > 0 ? `${rolesOpen} rol${rolesOpen > 1 ? "es" : ""} libre${rolesOpen > 1 ? "s" : ""}` : "Roles completos"}</span>
                  {myStatus && <span className={"my-status " + myStatus}>{myStatus === "si" ? "Vas" : myStatus === "no" ? "No vas" : "Quizás"}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <button className="fab" onClick={() => setScreen({ mode: "form", id: null })}><Plus size={24} /></button>
    </div>
  );
}

function Staff() {
  return (
    <svg width="100%" height="26" viewBox="0 0 400 26" preserveAspectRatio="none">
      {[4, 9, 14, 19, 24].map((y) => <line key={y} x1="0" y1={y} x2="400" y2={y} stroke="rgba(251,247,236,0.18)" strokeWidth="1" />)}
    </svg>
  );
}

function EventDetail({ ev, songs, members, isAdmin, me, attendance, onBack, onEdit, onDelete, onSetAttendance, onClaimRole, onAssignRole, requireMe }) {
  const t = typeInfo(ev.type);
  const counts = { si: 0, no: 0, "tal-vez": 0 };
  Object.values(attendance).forEach((s) => (counts[s] = (counts[s] || 0) + 1));
  const myStatus = attendance[me];

  return (
    <div>
      <button className="back-btn" onClick={onBack}><ArrowLeft size={16} /> Volver</button>
      <div className="card detail-head">
        <div className="clip" />
        <div className="card-header" style={{ background: t.color + "22", borderColor: t.color + "55", borderRadius: "14px 14px 0 0" }}><Staff /></div>
        <div className="detail-body">
          <div className="detail-top">
            <span className="badge" style={{ background: t.color + "26", color: t.color, borderColor: t.color + "66" }}>{t.label}</span>
            <div className="icon-row"><button className="icon-btn" onClick={onEdit}><Pencil size={15} /></button><button className="icon-btn" onClick={onDelete}><Trash2 size={15} /></button></div>
          </div>
          <h2>{ev.title}</h2>
          <div className="meta"><Calendar size={14} /> {fmtDate(ev.date)} {ev.time && <>· <Clock size={13} /> {ev.time} hs</>}</div>
          {ev.location && <div className="meta"><MapPin size={14} /> {ev.location}</div>}
          {ev.notes && <p className="notes">{ev.notes}</p>}
        </div>
      </div>

      <Section title="Tu asistencia" icon={<Check size={16} />}>
        <div className="att-btns">
          <button className={"att-yes" + (myStatus === "si" ? " active" : "")} onClick={() => onSetAttendance("si")}><Check size={15} /> Voy</button>
          <button className={"att-maybe" + (myStatus === "tal-vez" ? " active" : "")} onClick={() => onSetAttendance("tal-vez")}><HelpCircle size={15} /> Tal vez</button>
          <button className={"att-no" + (myStatus === "no" ? " active" : "")} onClick={() => onSetAttendance("no")}><X size={15} /> No voy</button>
        </div>
        <div className="att-summary">
          <span style={{ color: "#8FB88F" }}>{counts.si || 0} van</span>
          <span style={{ color: "#E4B75B" }}>{counts["tal-vez"] || 0} quizás</span>
          <span style={{ color: "#C97C87" }}>{counts.no || 0} no van</span>
        </div>
        {Object.keys(attendance).length > 0 && (
          <div className="names-wrap">{Object.entries(attendance).map(([name, status]) => <span key={name} className={"name-chip " + status}>{name}</span>)}</div>
        )}
      </Section>

      <Section title="Equipo asignado" icon={<Users size={16} />}>
        {(ev.roles || []).length === 0 && <p className="muted">No se cargaron roles para este evento.</p>}
        <div className="roles-list">
          {(ev.roles || []).map((r) => (
            <div key={r.id} className="role-row">
              <span className="role-name">{r.name}</span>
              {r.assignedTo ? (
                <button className="role-taken" onClick={() => r.assignedTo === me && onClaimRole(r.id)}>{r.assignedTo}</button>
              ) : (
                <button className="role-free" onClick={() => onClaimRole(r.id)}>Anotarme</button>
              )}
              {isAdmin && <AssignPicker members={members} current={r.assignedTo} onAssign={(name) => onAssignRole(r.id, name)} />}
            </div>
          ))}
        </div>
      </Section>

      {(ev.setlist || []).length > 0 && (
        <Section title="Repertorio / ensayo" icon={<ListMusic size={16} />}>
          <div className="setlist">
            {ev.setlist.map((s, i) => {
              const song = songs.find((sg) => sg.id === s.songId);
              return (
                <div key={s.id} className="setlist-item">
                  <span className="setlist-num">{i + 1}</span>
                  <div className="setlist-info">
                    <span className="setlist-title">{song?.title || s.title}</span>
                    <div className="setlist-sub">
                      {(s.key || song?.key) && <span className="setlist-key">{s.key || song.key}</span>}
                      {s.prepare && <span className="prep-flag">A sacar</span>}
                      {s.suggestedBy && <span className="setlist-note">sugerida por {s.suggestedBy}</span>}
                    </div>
                  </div>
                  {(s.refLink || song?.links?.[0]?.url) && (
                    <a href={s.refLink || song.links[0].url} target="_blank" rel="noreferrer" className="setlist-link"><LinkIcon size={13} /></a>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}

function AssignPicker({ members, current, onAssign }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button className="icon-btn-sm" onClick={() => setOpen(true)}><Pencil size={12} /></button>;
  return (
    <select className="mini-select" value={current || ""} onChange={(e) => { onAssign(e.target.value); setOpen(false); }} onBlur={() => setOpen(false)} autoFocus>
      <option value="">Sin asignar</option>
      {members.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
    </select>
  );
}

function EventForm({ initial, songs, onCancel, onSave }) {
  const [title, setTitle] = useState(initial?.title || "");
  const [type, setType] = useState(initial?.type || "servicio");
  const [date, setDate] = useState(initial?.date || "");
  const [time, setTime] = useState(initial?.time || "");
  const [location, setLocation] = useState(initial?.location || "");
  const [notes, setNotes] = useState(initial?.notes || "");
  const [roles, setRoles] = useState(initial?.roles || []);
  const [setlist, setSetlist] = useState(initial?.setlist || []);
  const [roleDraft, setRoleDraft] = useState("");
  const [songPick, setSongPick] = useState("");
  const [formErr, setFormErr] = useState("");

  function addRole() { if (!roleDraft.trim()) return; setRoles([...roles, { id: uid(), name: roleDraft.trim(), assignedTo: "" }]); setRoleDraft(""); }
  function removeRole(id) { setRoles(roles.filter((r) => r.id !== id)); }
  function addSongFromLibrary() {
    if (!songPick) return;
    const song = songs.find((s) => s.id === songPick);
    setSetlist([...setlist, { id: uid(), songId: song.id, title: song.title, key: song.key, prepare: false, suggestedBy: "", refLink: "" }]);
    setSongPick("");
  }
  function updateSetlistItem(id, patch) { setSetlist(setlist.map((s) => (s.id === id ? { ...s, ...patch } : s))); }
  function removeSong(id) { setSetlist(setlist.filter((s) => s.id !== id)); }

  function submit() {
    if (!title.trim() || !date) { setFormErr("Poné al menos un título y una fecha."); return; }
    onSave({ id: initial?.id, title: title.trim(), type, date, time, location: location.trim(), notes: notes.trim(), roles, setlist });
  }

  return (
    <div>
      <button className="back-btn" onClick={onCancel}><ArrowLeft size={16} /> Cancelar</button>
      <h2 className="form-title">{initial ? "Editar evento" : "Nuevo evento"}</h2>
      <label className="label">Título</label>
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Servicio dominical" />
      <label className="label">Tipo</label>
      <div className="type-row">
        {EVENT_TYPES.map((t) => (
          <button key={t.id} className="type-chip" style={{ borderColor: type === t.id ? t.color : "#3a3f66", background: type === t.id ? t.color + "26" : "transparent", color: type === t.id ? t.color : "#c7cbe8" }} onClick={() => setType(t.id)}>{t.label}</button>
        ))}
      </div>
      <div className="row2">
        <div style={{ flex: 1 }}><label className="label">Fecha</label><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div style={{ flex: 1 }}><label className="label">Hora</label><input type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} /></div>
      </div>
      <label className="label">Lugar</label>
      <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Salón principal" />
      <label className="label">Notas</label>
      <textarea className="input textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Detalles para el equipo" />
      <label className="label">Roles necesarios</label>
      <div className="chips-wrap">{roles.map((r) => <span key={r.id} className="edit-chip">{r.name} <X size={12} className="clickable" onClick={() => removeRole(r.id)} /></span>)}</div>
      <div className="add-row">
        <input className="input" value={roleDraft} onChange={(e) => setRoleDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addRole()} placeholder="Ej: Guitarra, Voz, Batería" />
        <button className="secondary-btn" onClick={addRole}><Plus size={15} /></button>
      </div>
      <label className="label">Repertorio / canciones a ensayar</label>
      {setlist.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          {setlist.map((s, i) => (
            <div key={s.id} className="setlist-edit-row">
              <div className="setlist-edit-top"><span className="setlist-num">{i + 1}</span><span style={{ flex: 1 }}>{s.title}</span><X size={14} className="clickable" onClick={() => removeSong(s.id)} /></div>
              <div className="setlist-edit-fields">
                <input className="mini-input" placeholder="Tonalidad" value={s.key || ""} onChange={(e) => updateSetlistItem(s.id, { key: e.target.value })} />
                <input className="mini-input" placeholder="Sugerida por" value={s.suggestedBy || ""} onChange={(e) => updateSetlistItem(s.id, { suggestedBy: e.target.value })} />
                <label className="prepare-toggle"><input type="checkbox" checked={!!s.prepare} onChange={(e) => updateSetlistItem(s.id, { prepare: e.target.checked })} /> A sacar</label>
              </div>
              <input className="input" placeholder="Link de referencia" value={s.refLink || ""} onChange={(e) => updateSetlistItem(s.id, { refLink: e.target.value })} />
            </div>
          ))}
        </div>
      )}
      <div className="add-row">
        <select className="input" value={songPick} onChange={(e) => setSongPick(e.target.value)}>
          <option value="">Elegir de la biblioteca…</option>
          {songs.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
        <button className="secondary-btn" onClick={addSongFromLibrary}><Plus size={15} /></button>
      </div>
      {songs.length === 0 && <p className="muted small">Todavía no cargaste canciones en la biblioteca (sección Canciones).</p>}
      {formErr && <div className="pin-error">{formErr}</div>}
      <button className="primary-btn full" onClick={submit}>{initial ? "Guardar cambios" : "Crear evento"}</button>
    </div>
  );
}

function CancionesTab({ songs, screen, setScreen, isAdmin, onSave, onDelete }) {
  const [q, setQ] = useState("");
  if (screen.mode === "form") {
    const song = screen.id ? songs.find((s) => s.id === screen.id) : null;
    return <SongForm initial={song} onCancel={() => setScreen({ mode: song ? "detail" : "list", id: screen.id })} onSave={onSave} />;
  }
  if (screen.mode === "detail") {
    const song = songs.find((s) => s.id === screen.id);
    if (!song) return null;
    return <SongDetail song={song} isAdmin={isAdmin} onBack={() => setScreen({ mode: "list", id: null })} onEdit={() => setScreen({ mode: "form", id: song.id })} onDelete={() => onDelete(song.id)} />;
  }
  const filtered = songs.filter((s) => s.title.toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <input className="input" placeholder="Buscar canción…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 16 }} />
      {filtered.length === 0 && (
        <div className="empty"><ListMusic size={28} color="#5b628f" /><p>No hay canciones cargadas.</p><button className="primary-btn" onClick={() => setScreen({ mode: "form", id: null })}><Plus size={16} /> Agregar canción</button></div>
      )}
      <div className="song-list">
        {filtered.map((s) => (
          <div key={s.id} className="song-row" onClick={() => setScreen({ mode: "detail", id: s.id })}>
            <div className="song-row-main">
              <span className="song-title">{s.title}</span>
              <div className="song-tags">{s.key && <span className="tag">{s.key}</span>}{s.bpm && <span className="tag">{s.bpm} bpm</span>}</div>
            </div>
            <ChevronRight size={16} color="#6b7099" />
          </div>
        ))}
      </div>
      {filtered.length > 0 && <button className="fab" onClick={() => setScreen({ mode: "form", id: null })}><Plus size={24} /></button>}
    </div>
  );
}

function SongDetail({ song, isAdmin, onBack, onEdit, onDelete }) {
  const [steps, setSteps] = useState(0);
  const [keyPicker, setKeyPicker] = useState(false);
  const displayKey = steps ? transposeChordToken(song.key || "", steps) : (song.key || "");
  const keyQuality = (song.key || "").match(/^[A-G](?:#|b)?(.*)$/)?.[1] || "";
  const keyOptions = CHROMA_SHARP.map((n) => n + keyQuality);
  const sections = song.sections && song.sections.length ? song.sections : (song.lyrics ? [{ id: "legacy", name: "Letra", text: song.lyrics }] : []);
  const refs = useMemo(() => sections.map(() => React.createRef()), [sections.length]);

  function jumpTo(i) { refs[i]?.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }
  function pickKey(option) {
    const optRoot = option.match(/^[A-G](?:#|b)?/)?.[0];
    const songRoot = (song.key || "").match(/^[A-G](?:#|b)?/)?.[0];
    const from = noteIndex(songRoot);
    const to = noteIndex(optRoot);
    if (from === -1 || to === -1) return;
    setSteps(to - from);
  }

  return (
    <div>
      <button className="back-btn" onClick={onBack}><ArrowLeft size={16} /> Volver</button>
      <div className="card detail-head">
        <div className="detail-body">
          <div className="detail-top">
            <span className="badge" style={{ background: "#7C93C726", color: "#7C93C7", borderColor: "#7C93C766" }}>Canción</span>
            <div className="icon-row"><button className="icon-btn" onClick={onEdit}><Pencil size={15} /></button><button className="icon-btn" onClick={onDelete}><Trash2 size={15} /></button></div>
          </div>
          <h2>{song.title}</h2>
          <div className="meta">{song.bpm && <span>{song.bpm} BPM</span>}</div>

          <button className="cc-tono-btn" onClick={() => setKeyPicker(!keyPicker)}>
            Tono: <span className="cc-tono-value">{displayKey || "—"}</span>
          </button>

          {keyPicker && (
            <div className="key-picker-panel">
              <div className="key-picker-half-row">
                <button className="key-picker-half" onClick={() => setSteps(steps - 1)}>−1/2 tono</button>
                <button className="key-picker-half" onClick={() => setSteps(steps + 1)}>+1/2 tono</button>
              </div>
              <div className="key-picker">
                {keyOptions.map((n) => (
                  <button key={n} className={"key-picker-item" + (n === displayKey ? " active" : "")} onClick={() => pickKey(n)}>{n}</button>
                ))}
              </div>
              {steps !== 0 && <button className="secondary-btn cc-reset" onClick={() => setSteps(0)}>Volver al original ({song.key})</button>}
            </div>
          )}

          {sections.length > 0 && (
            <div className="section-nav">
              {sections.map((s, i) => {
                const m = sectionMeta(s.name);
                return (
                  <button key={s.id} className="section-chip" style={{ borderColor: m.color, color: m.color }} onClick={() => jumpTo(i)}>{m.abbr}</button>
                );
              })}
            </div>
          )}

          <div className="song-desc">{song.description || "Sin descripción"}</div>
        </div>
      </div>

      {sections.map((s, i) => {
        const m = sectionMeta(s.name);
        const text = transposeLyrics(s.text || "", steps);
        return (
          <div key={s.id} ref={refs[i]} className="section-block">
            <span className="section-pill" style={{ background: m.color + "26", color: m.color, borderColor: m.color + "66" }}>
              <span className="section-pill-abbr" style={{ borderColor: m.color }}>{m.abbr}</span> {s.name}
            </span>
            <div className="chordchart">
              {text.split("\n").map((line, li) => {
                const { chords, lyrics } = splitChordLine(line);
                return (
                  <div key={li} className="chordchart-line">
                    {chords.trim() && <div className="chordchart-chords">{chords}</div>}
                    <div className="chordchart-lyrics">{lyrics || "\u00A0"}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {(song.links || []).length > 0 && (
        <Section title="Archivos y links" icon={<Paperclip size={16} />}>
          <div className="links-list">{song.links.map((l, i) => <a key={i} href={l.url} target="_blank" rel="noreferrer" className="link-row"><LinkIcon size={13} /> {l.label || l.url}</a>)}</div>
        </Section>
      )}
    </div>
  );
}

function SongForm({ initial, onCancel, onSave }) {
  const [title, setTitle] = useState(initial?.title || "");
  const [key, setKey] = useState(initial?.key || "");
  const [bpm, setBpm] = useState(initial?.bpm || "");
  const [description, setDescription] = useState(initial?.description || initial?.structure || "");
  const [sections, setSections] = useState(initial?.sections?.length ? initial.sections : (initial?.lyrics ? [{ id: uid(), name: "Letra", text: initial.lyrics }] : [{ id: uid(), name: "Estrofa", text: "" }]));
  const [links, setLinks] = useState(initial?.links || []);
  const [linkDraft, setLinkDraft] = useState({ label: "", url: "" });
  const [formErr, setFormErr] = useState("");

  function addSection() { setSections([...sections, { id: uid(), name: "Coro", text: "" }]); }
  function updateSection(id, patch) { setSections(sections.map((s) => (s.id === id ? { ...s, ...patch } : s))); }
  function removeSection(id) { setSections(sections.filter((s) => s.id !== id)); }
  function addLink() { if (!linkDraft.url.trim()) return; setLinks([...links, { ...linkDraft }]); setLinkDraft({ label: "", url: "" }); }
  function removeLink(i) { setLinks(links.filter((_, idx) => idx !== i)); }
  function submit() {
    if (!title.trim()) { setFormErr("Poné al menos un título."); return; }
    onSave({ id: initial?.id, title: title.trim(), key: key.trim(), bpm: bpm.trim(), description: description.trim(), sections, links });
  }

  return (
    <div>
      <button className="back-btn" onClick={onCancel}><ArrowLeft size={16} /> Cancelar</button>
      <h2 className="form-title">{initial ? "Editar canción" : "Nueva canción"}</h2>
      <label className="label">Título</label>
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sublime gracia" />
      <div className="row2">
        <div style={{ flex: 1 }}><label className="label">Tonalidad original</label><input className="input" value={key} onChange={(e) => setKey(e.target.value)} placeholder="G" /></div>
        <div style={{ flex: 1 }}><label className="label">BPM</label><input className="input" value={bpm} onChange={(e) => setBpm(e.target.value)} placeholder="72" /></div>
      </div>
      <label className="label">Descripción (opcional)</label>
      <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Notas generales de la canción" />

      <label className="label">Secciones</label>
      <p className="hint">Escribí los acordes entre corchetes en cada línea, ej: [G]Sublime [C]gracia. Usá nombres como Intro, Estrofa, Preestribillo, Coro, Interludio, Puente — así se colorean solos.</p>
      {sections.map((s) => {
        const m = sectionMeta(s.name);
        return (
          <div key={s.id} className="section-edit-block">
            <div className="section-edit-head">
              <span className="section-pill-abbr small" style={{ borderColor: m.color, color: m.color }}>{m.abbr}</span>
              <input className="input" style={{ flex: 1 }} value={s.name} onChange={(e) => updateSection(s.id, { name: e.target.value })} placeholder="Nombre de la sección" />
              {sections.length > 1 && <X size={16} className="clickable" onClick={() => removeSection(s.id)} />}
            </div>
            <textarea className="input textarea" value={s.text} onChange={(e) => updateSection(s.id, { text: e.target.value })} placeholder={"[G]Sublime [C]gracia del [D]señor…"} />
          </div>
        );
      })}
      <button className="secondary-btn" onClick={addSection}><Plus size={15} /> Agregar sección</button>

      <label className="label" style={{ marginTop: 20 }}>Archivos y links</label>
      {links.length > 0 && <div className="chips-wrap">{links.map((l, i) => <span key={i} className="edit-chip">{l.label || l.url} <X size={12} className="clickable" onClick={() => removeLink(i)} /></span>)}</div>}
      <div className="add-row">
        <input className="input" placeholder="Etiqueta (ej: Acordes, Audio)" value={linkDraft.label} onChange={(e) => setLinkDraft({ ...linkDraft, label: e.target.value })} />
        <input className="input" placeholder="URL" value={linkDraft.url} onChange={(e) => setLinkDraft({ ...linkDraft, url: e.target.value })} />
        <button className="secondary-btn" onClick={addLink}><Plus size={15} /></button>
      </div>
      {formErr && <div className="pin-error">{formErr}</div>}
      <button className="primary-btn full" onClick={submit}>{initial ? "Guardar cambios" : "Agregar canción"}</button>
    </div>
  );
}

function EquipoTab({ members, screen, setScreen, isAdmin, me, onSave, onDelete, requireMe }) {
  if (screen.mode === "form") {
    const m = screen.id ? members.find((x) => x.id === screen.id) : null;
    return <MemberForm initial={m} me={me} onCancel={() => setScreen({ mode: "list", id: null })} onSave={onSave} />;
  }
  const canEdit = (m) => isAdmin || m.name === me;
  return (
    <div>
      {members.length === 0 && (
        <div className="empty"><Users size={28} color="#5b628f" /><p>Todavía no hay músicos cargados.</p>
          <button className="primary-btn" onClick={() => requireMe(() => setScreen({ mode: "form", id: null }))}><Plus size={16} /> Sumarme al equipo</button>
        </div>
      )}
      <div className="member-list">
        {members.map((m) => (
          <div key={m.id} className="card member-card">
            <div className="member-head">
              <div className="member-avatar">{m.name.slice(0, 1).toUpperCase()}</div>
              <div style={{ flex: 1 }}>
                <div className="member-name">{m.name}</div>
                <div className="member-role">{m.voice === "principal" ? "Voz principal" : m.voice === "coro" ? "Coro" : ""}{m.voice && m.instruments?.length ? " · " : ""}{(m.instruments || []).join(", ")}</div>
              </div>
              {canEdit(m) && <button className="icon-btn" onClick={() => setScreen({ mode: "form", id: m.id })}><Pencil size={14} /></button>}
              {isAdmin && <button className="icon-btn" onClick={() => onDelete(m.id)}><Trash2 size={14} /></button>}
            </div>
            <div className="avail-row">{DAYS.map((d, i) => <span key={d} className={"avail-day" + (m.availability?.[i] ? " on" : "")}>{d}</span>)}</div>
          </div>
        ))}
      </div>
      {members.length > 0 && (
        <button className="fab" onClick={() => requireMe((name) => { const existing = members.find((m) => m.name === name); setScreen({ mode: "form", id: existing?.id || null }); })}><Plus size={24} /></button>
      )}
    </div>
  );
}

function MemberForm({ initial, me, onCancel, onSave }) {
  const [name] = useState(initial?.name || me || "");
  const [voice, setVoice] = useState(initial?.voice || "");
  const [instruments, setInstruments] = useState(initial?.instruments || []);
  const [instDraft, setInstDraft] = useState("");
  const [availability, setAvailability] = useState(initial?.availability || {});
  const [formErr, setFormErr] = useState("");

  function addInst() { if (!instDraft.trim()) return; setInstruments([...instruments, instDraft.trim()]); setInstDraft(""); }
  function removeInst(i) { setInstruments(instruments.filter((_, idx) => idx !== i)); }
  function toggleDay(i) { setAvailability({ ...availability, [i]: !availability[i] }); }
  function submit() {
    if (!name.trim()) { setFormErr("Ingresá un nombre."); return; }
    onSave({ id: initial?.id, name: name.trim(), voice, instruments, availability });
  }

  return (
    <div>
      <button className="back-btn" onClick={onCancel}><ArrowLeft size={16} /> Cancelar</button>
      <h2 className="form-title">{initial ? "Editar músico" : "Sumarme al equipo"}</h2>
      <label className="label">Nombre</label>
      <input className="input" value={name} placeholder="Nombre y apellido" disabled />
      <p className="hint">Este es el nombre de tu cuenta de Google, no se puede cambiar acá.</p>
      <label className="label">Voz</label>
      <div className="type-row">
        {["principal", "coro"].map((v) => (
          <button key={v} className="type-chip" style={{ borderColor: voice === v ? "#E4B75B" : "#3a3f66", background: voice === v ? "#E4B75B26" : "transparent", color: voice === v ? "#E4B75B" : "#c7cbe8" }} onClick={() => setVoice(voice === v ? "" : v)}>
            {v === "principal" ? "Voz principal" : "Coro"}
          </button>
        ))}
      </div>
      <label className="label">Instrumentos</label>
      <div className="chips-wrap">{instruments.map((i, idx) => <span key={idx} className="edit-chip">{i} <X size={12} className="clickable" onClick={() => removeInst(idx)} /></span>)}</div>
      <div className="add-row">
        <input className="input" value={instDraft} onChange={(e) => setInstDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addInst()} placeholder="Ej: Guitarra, Batería" />
        <button className="secondary-btn" onClick={addInst}><Plus size={15} /></button>
      </div>
      <label className="label">Disponibilidad semanal</label>
      <div className="avail-row edit">{DAYS.map((d, i) => <button key={d} className={"avail-day clickable" + (availability[i] ? " on" : "")} onClick={() => toggleDay(i)}>{d}</button>)}</div>
      {formErr && <div className="pin-error">{formErr}</div>}
      <button className="primary-btn full" onClick={submit}>{initial ? "Guardar cambios" : "Sumarme"}</button>
    </div>
  );
}

function RecursosTab({ resources, screen, setScreen, isAdmin, onSave, onDelete }) {
  const [filter, setFilter] = useState("todos");
  if (screen.mode === "form") {
    const r = screen.id ? resources.find((x) => x.id === screen.id) : null;
    return <ResourceForm initial={r} onCancel={() => setScreen({ mode: "list", id: null })} onSave={onSave} />;
  }
  const filtered = filter === "todos" ? resources : resources.filter((r) => r.type === filter);
  return (
    <div>
      <div className="tabs wrap">
        <button className={"tab" + (filter === "todos" ? " active" : "")} onClick={() => setFilter("todos")}>Todos</button>
        {RESOURCE_TYPES.map((t) => <button key={t.id} className={"tab" + (filter === t.id ? " active" : "")} onClick={() => setFilter(t.id)}>{t.label}</button>)}
      </div>
      {filtered.length === 0 && (
        <div className="empty"><FolderOpen size={28} color="#5b628f" /><p>No hay recursos cargados.</p>{isAdmin && <button className="primary-btn" onClick={() => setScreen({ mode: "form", id: null })}><Plus size={16} /> Agregar recurso</button>}</div>
      )}
      <div className="resource-list">
        {filtered.map((r) => {
          const rt = RESOURCE_TYPES.find((t) => t.id === r.type) || RESOURCE_TYPES[4];
          const Icon = rt.icon;
          return (
            <a key={r.id} href={r.url} target="_blank" rel="noreferrer" className="resource-row">
              <Icon size={16} color="#E4B75B" /><span style={{ flex: 1 }}>{r.label}</span><span className="tag">{rt.label}</span>
              {isAdmin && <X size={14} className="clickable" onClick={(e) => { e.preventDefault(); onDelete(r.id); }} />}
            </a>
          );
        })}
      </div>
      {isAdmin && filtered.length > 0 && <button className="fab" onClick={() => setScreen({ mode: "form", id: null })}><Plus size={24} /></button>}
    </div>
  );
}

function ResourceForm({ initial, onCancel, onSave }) {
  const [label, setLabel] = useState(initial?.label || "");
  const [type, setType] = useState(initial?.type || "pdf");
  const [url, setUrl] = useState(initial?.url || "");
  const [formErr, setFormErr] = useState("");
  function submit() {
    if (!label.trim() || !url.trim()) { setFormErr("Completá el nombre y el link."); return; }
    onSave({ id: initial?.id, label: label.trim(), type, url: url.trim() });
  }
  return (
    <div>
      <button className="back-btn" onClick={onCancel}><ArrowLeft size={16} /> Cancelar</button>
      <h2 className="form-title">{initial ? "Editar recurso" : "Nuevo recurso"}</h2>
      <p className="hint">Los archivos se guardan como links (Drive, YouTube, Dropbox, etc.), no como subida directa.</p>
      <label className="label">Nombre</label>
      <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Partitura - Sublime gracia" />
      <label className="label">Tipo</label>
      <div className="type-row">
        {RESOURCE_TYPES.map((t) => (
          <button key={t.id} className="type-chip" style={{ borderColor: type === t.id ? "#E4B75B" : "#3a3f66", background: type === t.id ? "#E4B75B26" : "transparent", color: type === t.id ? "#E4B75B" : "#c7cbe8" }} onClick={() => setType(t.id)}>{t.label}</button>
        ))}
      </div>
      <label className="label">Link</label>
      <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://drive.google.com/…" />
      {formErr && <div className="pin-error">{formErr}</div>}
      <button className="primary-btn full" onClick={submit}>{initial ? "Guardar cambios" : "Agregar recurso"}</button>
    </div>
  );
}

const CSS = `
  * { box-sizing: border-box; font-family: 'Work Sans', sans-serif; }
  h1,h2,h3 { font-family: 'Fraunces', serif; margin: 0; }
  button { font-family: inherit; cursor: pointer; border: none; background: none; }
  input, textarea, select { font-family: inherit; }
  ::placeholder { color: #6b7099; }
  .afina-app { min-height: 100%; background: #1B1F3B; color: #EDEBFA; padding-bottom: 76px; }
  .header { display:flex; align-items:center; justify-content:space-between; padding:16px 18px; border-bottom:1px solid #2E3358; position:sticky; top:0; background:#1B1F3Bee; backdrop-filter: blur(6px); z-index:10; }
  .brand { display:flex; align-items:center; gap:8px; font-family:'Fraunces',serif; font-size:20px; font-weight:700; color:#FBF7EC; }
  .admin-btn { display:flex; align-items:center; gap:6px; background:#2E3358; color:#E4B75B; padding:7px 12px; border-radius:20px; font-size:13px; font-weight:600; }
  .admin-btn.ghost { background:transparent; color:#9aa2c9; }
  .header-actions { display:flex; align-items:center; gap:8px; }
  .app-footer { text-align:center; padding:18px 0 8px; font-size:11px; color:#4a4e75; }
  .help-links { display:flex; flex-direction:column; gap:8px; margin-top:6px; }
  .help-link { display:flex; align-items:center; gap:8px; background:#232853; color:#EDEBFA; padding:10px 14px; border-radius:10px; font-size:14px; text-decoration:none; }
  .help-author { text-align:center; font-size:11px; color:#6b7099; margin-top:16px; }
  .err-banner { background:#8C3B4A; color:#FBF7EC; padding:8px 18px; font-size:13px; cursor:pointer; }
  .main { max-width:720px; margin:0 auto; padding:18px 16px; }
  .loading { text-align:center; padding:60px; color:#9aa2c9; font-family:'Fraunces',serif; font-size:18px; }
  .team-setup { text-align:center; padding:50px 20px; display:flex; flex-direction:column; align-items:center; gap:10px; }
  .team-setup .input { max-width:280px; margin-top:12px; }
  .team-pick-list { display:flex; flex-direction:column; gap:8px; width:100%; max-width:320px; margin-top:6px; }
  .team-pick-row { display:flex; align-items:center; gap:8px; background:#232853; color:#EDEBFA; padding:12px 16px; border-radius:10px; font-size:14px; font-weight:600; width:100%; justify-content:center; }
  .team-gate-tabs { display:flex; gap:6px; margin:18px 0 4px; background:#232853; padding:4px; border-radius:12px; }
  .team-gate-tabs .tab { display:flex; align-items:center; gap:5px; }
  .team-menu-wrap { position:relative; }
  .team-menu-wrap .brand { display:flex; align-items:center; gap:8px; }
  .team-menu-dropdown { position:absolute; top:calc(100% + 8px); left:0; background:#232853; border:1px solid #3a4066; border-radius:12px; min-width:240px; padding:10px; z-index:50; box-shadow:0 10px 24px rgba(0,0,0,0.4); }
  .team-menu-section { padding:6px 8px 12px; border-bottom:1px solid #3a3f66; margin-bottom:6px; }
  .team-code-row { display:flex; align-items:center; justify-content:space-between; background:#1B1F3B; padding:8px 10px; border-radius:8px; font-family:'Fraunces',serif; font-weight:700; letter-spacing:1px; color:#E4B75B; cursor:pointer; }
  .team-copied { font-size:11px; color:#8FB88F; margin-top:4px; }
  .team-menu-item { display:flex; align-items:center; gap:8px; width:100%; text-align:left; padding:9px 8px; border-radius:8px; font-size:13px; color:#EDEBFA; }
  .team-menu-item:hover { background:#1B1F3B; }
  .tabs { display:flex; gap:6px; margin-bottom:18px; background:#232853; padding:4px; border-radius:12px; width:fit-content; }
  .tabs.wrap { flex-wrap:wrap; width:100%; }
  .tab { padding:8px 16px; border-radius:9px; color:#9aa2c9; font-size:13px; font-weight:600; }
  .tab.active { background:#E4B75B; color:#1B1F3B; font-weight:700; }
  .empty { display:flex; flex-direction:column; align-items:center; gap:12px; padding:50px 20px; color:#9aa2c9; text-align:center; }
  .empty.small { padding:24px 20px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:22px; margin-top:10px; }
  .card { position:relative; background:#FBF7EC; border-radius:14px; overflow:hidden; border:1px solid #2E3358; box-shadow:0 6px 18px rgba(0,0,0,0.28); }
  .event-card { cursor:pointer; }
  .clip { position:absolute; top:-18px; left:50%; transform:translateX(-50%); width:34px; height:20px; background:#E4B75B; border:3px solid #C79A3E; border-radius:6px; z-index:2; }
  .card-header { padding:14px 16px 0; border-bottom:1px solid; }
  .card-body { padding:12px 16px 16px; color:#2A2F55; }
  .badge { display:inline-block; font-size:11px; font-weight:700; padding:3px 9px; border-radius:20px; border:1px solid; text-transform:uppercase; letter-spacing:.4px; }
  .card-body h3 { font-size:19px; margin:8px 0 6px; color:#1B1F3B; }
  .meta { display:flex; gap:6px; align-items:center; font-size:13px; color:#5b6088; margin-top:3px; flex-wrap:wrap; }
  .card-footer { display:flex; justify-content:space-between; align-items:center; margin-top:12px; padding-top:10px; border-top:1px dashed #d8d2bf; }
  .card-footer-item { display:flex; align-items:center; gap:5px; font-size:12px; color:#7a7f5f; }
  .my-status { font-size:12px; font-weight:700; }
  .my-status.si { color:#3f7a4a; } .my-status.no { color:#9c3f4a; } .my-status.tal-vez { color:#a3791f; }
  .fab { position:fixed; bottom:84px; right:20px; width:54px; height:54px; border-radius:50%; background:#E4B75B; color:#1B1F3B; display:flex; align-items:center; justify-content:center; box-shadow:0 8px 20px rgba(0,0,0,0.4); z-index:20; }
  .back-btn { display:flex; align-items:center; gap:6px; color:#9aa2c9; font-size:14px; margin-bottom:16px; padding:6px 0; }
  .detail-head { margin-top:10px; }
  .detail-body { padding:14px 20px 20px; color:#2A2F55; }
  .detail-top { display:flex; justify-content:space-between; align-items:flex-start; gap:8px; }
  .icon-row { display:flex; gap:8px; }
  .detail-body h2 { font-size:24px; margin:10px 0 8px; color:#1B1F3B; }
  .notes { margin-top:12px; font-size:14px; color:#4a4e75; line-height:1.5; border-top:1px dashed #d8d2bf; padding-top:10px; }
  .icon-btn { background:#EDE7D6; color:#5b6088; padding:7px; border-radius:8px; display:flex; }
  .icon-btn-sm { background:#2E3358; color:#c7cbe8; padding:5px; border-radius:6px; display:flex; }
  .section { margin-top:22px; }
  .section-title { display:flex; align-items:center; gap:7px; font-family:'Fraunces',serif; font-size:16px; font-weight:600; color:#E4B75B; margin-bottom:10px; }
  .att-btns { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; }
  .att-yes,.att-maybe,.att-no { display:flex; align-items:center; gap:6px; padding:9px 14px; border-radius:10px; background:#232853; border:1px solid #3a4066; font-size:13px; font-weight:600; }
  .att-yes { color:#8FB88F; } .att-maybe { color:#E4B75B; } .att-no { color:#C97C87; }
  .att-yes.active { background:#8FB88F; color:#1B1F3B; border-color:#8FB88F; font-weight:700; }
  .att-maybe.active { background:#E4B75B; color:#1B1F3B; border-color:#E4B75B; font-weight:700; }
  .att-no.active { background:#C97C87; color:#1B1F3B; border-color:#C97C87; font-weight:700; }
  .att-summary { display:flex; gap:16px; margin-top:12px; font-size:13px; font-weight:600; }
  .names-wrap { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; }
  .name-chip { font-size:12px; padding:4px 10px; border-radius:20px; border:1px solid #3a4066; color:#c7cbe8; }
  .name-chip.si { border-color:#8FB88F55; } .name-chip.no { border-color:#C97C8755; } .name-chip.tal-vez { border-color:#E4B75B55; }
  .muted { color:#9aa2c9; font-size:14px; } .muted.small { font-size:12px; margin-top:6px; }
  .roles-list { display:flex; flex-direction:column; gap:8px; }
  .role-row { display:flex; align-items:center; gap:8px; background:#232853; padding:10px 12px; border-radius:10px; }
  .role-name { flex:1; font-size:14px; font-weight:600; }
  .role-taken { background:#3a4066; color:#E4B75B; padding:6px 12px; border-radius:8px; font-size:13px; font-weight:600; }
  .role-free { background:#E4B75B; color:#1B1F3B; padding:6px 12px; border-radius:8px; font-size:13px; font-weight:700; }
  .mini-select { background:#1B1F3B; color:#EDEBFA; border:1px solid #3a4066; border-radius:6px; font-size:12px; padding:4px; }
  .setlist { display:flex; flex-direction:column; gap:6px; }
  .setlist-item { display:flex; align-items:center; gap:10px; background:#232853; padding:9px 12px; border-radius:9px; }
  .setlist-num { font-size:12px; color:#6b7099; font-weight:700; min-width:16px; }
  .setlist-info { flex:1; display:flex; flex-direction:column; gap:3px; }
  .setlist-title { font-size:14px; font-weight:500; }
  .setlist-sub { display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
  .setlist-key { font-size:11px; color:#E4B75B; font-weight:700; background:#1B1F3B; padding:2px 8px; border-radius:6px; }
  .setlist-note { font-size:11px; color:#9aa2c9; }
  .setlist-link { color:#7C93C7; display:flex; }
  .prep-flag { font-size:11px; color:#C97C87; font-weight:700; background:#1B1F3B; padding:2px 8px; border-radius:6px; }
  .prep-list { display:flex; flex-direction:column; gap:6px; }
  .prep-item { display:flex; align-items:center; gap:10px; background:#232853; padding:9px 12px; border-radius:9px; }
  .prep-title { flex:1; font-size:14px; font-weight:500; }
  .prep-key { font-size:11px; color:#E4B75B; font-weight:700; background:#1B1F3B; padding:2px 8px; border-radius:6px; }
  .form-title { font-size:24px; margin-bottom:18px; }
  .label { display:block; font-size:12px; font-weight:700; color:#9aa2c9; text-transform:uppercase; letter-spacing:.5px; margin-top:14px; margin-bottom:6px; }
  .hint { font-size:12px; color:#9aa2c9; margin:-2px 0 8px; }
  .input { width:100%; background:#232853; border:1px solid #3a4066; color:#EDEBFA; padding:10px 12px; border-radius:9px; font-size:14px; outline:none; }
  .input:disabled { opacity:.6; }
  .textarea { min-height:70px; resize:vertical; }
  .textarea.tall { min-height:140px; }
  .mini-input { background:#1B1F3B; border:1px solid #3a4066; color:#EDEBFA; padding:6px 8px; border-radius:6px; font-size:12px; flex:1; }
  .row2 { display:flex; gap:12px; }
  .type-row { display:flex; gap:8px; flex-wrap:wrap; }
  .type-chip { padding:8px 14px; border-radius:20px; border:1px solid; font-size:13px; font-weight:600; }
  .chips-wrap { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px; }
  .edit-chip { display:flex; align-items:center; gap:6px; background:#2E3358; color:#EDEBFA; padding:5px 10px; border-radius:20px; font-size:13px; }
  .add-row { display:flex; gap:8px; margin-bottom:6px; }
  .setlist-edit-row { background:#232853; padding:9px 10px; border-radius:9px; margin-bottom:8px; display:flex; flex-direction:column; gap:6px; }
  .setlist-edit-top { display:flex; align-items:center; gap:8px; font-size:13px; }
  .setlist-edit-fields { display:flex; gap:6px; align-items:center; }
  .prepare-toggle { display:flex; align-items:center; gap:4px; font-size:11px; color:#c7cbe8; white-space:nowrap; }
  .primary-btn { display:flex; align-items:center; gap:7px; background:#E4B75B; color:#1B1F3B; padding:11px 18px; border-radius:10px; font-size:14px; font-weight:700; margin-top:14px; }
  .primary-btn.full { width:100%; justify-content:center; }
  .secondary-btn { display:flex; align-items:center; justify-content:center; background:#2E3358; color:#E4B75B; padding:0 14px; border-radius:9px; font-size:14px; font-weight:700; }
  .overlay { position:fixed; inset:0; background:rgba(10,12,26,0.7); display:flex; align-items:center; justify-content:center; z-index:100; padding:20px; }
  .modal { position:relative; background:#232853; border-radius:16px; padding:26px; max-width:360px; width:100%; border:1px solid #3a4066; }
  .modal-close { position:absolute; top:14px; right:14px; color:#9aa2c9; }
  .modal-title { font-size:20px; margin-bottom:6px; padding-right:20px; }
  .modal-sub { font-size:13px; color:#9aa2c9; margin-bottom:14px; }
  .pin-error { color:#C97C87; font-size:13px; margin-top:6px; }
  .change-pin { margin-top:14px; border-top:1px solid #3a3f66; padding-top:12px; }
  .featured { cursor:pointer; }
  .featured-head { display:flex; align-items:center; gap:6px; padding:10px 16px; font-size:12px; font-weight:700; color:#EDEBFA; text-transform:uppercase; letter-spacing:.5px; }
  .featured-body { padding:14px 16px 18px; color:#2A2F55; }
  .featured-body h3 { font-size:20px; color:#1B1F3B; margin-bottom:6px; }
  .avail-row { display:flex; gap:6px; flex-wrap:wrap; }
  .avail-row.edit { margin-top:4px; }
  .avail-day { font-size:11px; font-weight:700; padding:6px 9px; border-radius:8px; background:#232853; color:#5b628f; }
  .avail-day.on { background:#8FB88F; color:#1B1F3B; }
  button.avail-day { cursor:pointer; }
  .aviso-row { display:flex; justify-content:space-between; align-items:center; gap:8px; background:#232853; padding:9px 12px; border-radius:9px; margin-bottom:6px; font-size:13px; }
  .clickable { cursor:pointer; }
  .song-list { display:flex; flex-direction:column; gap:8px; }
  .song-row { display:flex; align-items:center; gap:10px; background:#232853; padding:12px 14px; border-radius:11px; cursor:pointer; }
  .song-row-main { flex:1; display:flex; flex-direction:column; gap:5px; }
  .song-title { font-size:15px; font-weight:600; font-family:'Fraunces',serif; }
  .song-tags { display:flex; gap:6px; }
  .tag { font-size:11px; color:#9aa2c9; background:#1B1F3B; padding:2px 8px; border-radius:6px; }
  .transpose-row { display:flex; align-items:center; gap:14px; }
  .key-display { font-family:'Fraunces',serif; font-size:26px; font-weight:700; color:#E4B75B; min-width:44px; text-align:center; }
  .lyrics { background:#232853; border-radius:12px; padding:16px 18px; font-family:'Work Sans',monospace; font-size:14px; line-height:1.9; }
  .lyrics-line { white-space:pre-wrap; }
  .chord { color:#E4B75B; font-weight:700; }
  .transpose-cc-row { display:flex; align-items:center; gap:10px; margin-top:14px; }
  .cc-arrow { background:#232853; color:#E4B75B; width:34px; height:34px; border-radius:50%; font-size:20px; display:flex; align-items:center; justify-content:center; }
  .cc-key { font-family:'Fraunces',serif; font-size:22px; font-weight:700; color:#E4B75B; background:#232853; padding:6px 18px; border-radius:10px; min-width:56px; text-align:center; }
  .cc-reset { padding:0 12px; height:34px; }
  .cc-tono-btn { margin-top:14px; background:#232853; color:#EDEBFA; padding:10px 16px; border-radius:10px; font-size:15px; font-weight:600; }
  .cc-tono-value { color:#E4B75B; font-family:'Fraunces',serif; font-weight:700; }
  .key-picker-panel { margin-top:10px; background:#232853; border-radius:12px; padding:14px; }
  .key-picker-half-row { display:flex; gap:8px; margin-bottom:12px; }
  .key-picker-half { flex:1; background:#1B1F3B; color:#EDEBFA; padding:12px; border-radius:10px; font-size:14px; font-weight:600; text-align:center; }
  .key-picker { display:flex; flex-wrap:wrap; gap:6px; }
  .key-picker-item { padding:8px 10px; border-radius:8px; font-size:13px; font-weight:600; color:#c7cbe8; background:#1B1F3B; min-width:44px; }
  .key-picker-item.active { background:#E4B75B; color:#1B1F3B; }
  .section-nav { display:flex; gap:8px; overflow-x:auto; padding:14px 0 4px; }
  .section-chip { flex-shrink:0; width:32px; height:32px; border-radius:50%; border:2px solid; font-size:11px; font-weight:700; background:transparent; }
  .song-desc { font-size:13px; color:#5b6088; margin-top:8px; padding-top:10px; border-top:1px dashed #d8d2bf; }
  .section-block { margin-top:20px; scroll-margin-top:16px; }
  .section-pill { display:inline-flex; align-items:center; gap:8px; font-size:13px; font-weight:700; padding:5px 12px 5px 5px; border-radius:20px; border:1px solid; margin-bottom:8px; }
  .section-pill-abbr { display:flex; align-items:center; justify-content:center; width:22px; height:22px; border-radius:50%; border:1.5px solid; font-size:10px; background:#1B1F3B; }
  .section-pill-abbr.small { width:26px; height:26px; border-radius:8px; font-size:11px; background:#232853; flex-shrink:0; }
  .chordchart { background:#232853; border-radius:12px; padding:14px 16px; font-family:'Work Sans',monospace; font-size:13px; }
  .chordchart-line { margin-bottom:4px; }
  .chordchart-chords { color:#E4B75B; font-weight:700; white-space:pre; line-height:1.2; }
  .chordchart-lyrics { color:#EDEBFA; white-space:pre; line-height:1.5; }
  .section-edit-block { background:#232853; border-radius:10px; padding:10px; margin-bottom:10px; }
  .section-edit-head { display:flex; align-items:center; gap:8px; margin-bottom:8px; }
  .links-list { display:flex; flex-direction:column; gap:8px; }
  .link-row { display:flex; align-items:center; gap:8px; color:#7C93C7; font-size:14px; text-decoration:none; background:#232853; padding:9px 12px; border-radius:9px; }
  .member-list { display:flex; flex-direction:column; gap:14px; }
  .member-card { padding:14px 16px; }
  .member-head { display:flex; align-items:center; gap:10px; margin-bottom:10px; }
  .member-avatar { width:38px; height:38px; border-radius:50%; background:#1B1F3B; color:#E4B75B; display:flex; align-items:center; justify-content:center; font-weight:700; font-family:'Fraunces',serif; }
  .member-name { font-weight:700; color:#1B1F3B; font-size:15px; }
  .member-role { font-size:12px; color:#5b6088; }
  .resource-list { display:flex; flex-direction:column; gap:8px; }
  .resource-row { display:flex; align-items:center; gap:10px; background:#232853; padding:12px 14px; border-radius:11px; text-decoration:none; color:#EDEBFA; font-size:14px; }
  .bottom-nav { position:fixed; bottom:0; left:0; right:0; background:#171a33; border-top:1px solid #2E3358; display:flex; justify-content:space-around; padding:8px 4px calc(8px + env(safe-area-inset-bottom)); z-index:30; }
  .nav-btn { display:flex; flex-direction:column; align-items:center; gap:3px; color:#6b7099; font-size:10px; font-weight:600; padding:4px 8px; border-radius:10px; }
  .nav-btn.active { color:#E4B75B; }
  @media (max-width:480px){ .grid{ grid-template-columns:1fr; } .row2{ flex-direction:column; } }
`;
