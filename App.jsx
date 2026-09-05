import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Music, Calendar, MapPin, Clock, Users, Plus, X, Check, HelpCircle, Lock, Unlock,
  Trash2, Pencil, ListMusic, Link as LinkIcon, ArrowLeft, Home, FolderOpen,
  ArrowUpCircle, ArrowDownCircle, Megaphone, ChevronRight, FileText,
  Headphones, Video, Paperclip, Star, CalendarDays, LogOut, Copy, ChevronDown, UserPlus,
  MessageCircle, Mail, Presentation, Play, Square, ClipboardPaste, Settings, Eye, EyeOff,
} from "lucide-react";
import {
  supabase, kvGet, kvSet, signInWithGoogle, signOut,
  createTeam, joinTeamByCode, getUserTeams, saveUserTeams,
} from "./supabaseClient";

const FONTS = `@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;0,9..144,700;1,9..144,500&family=Work+Sans:wght@400;500;600;700&family=Manrope:wght@700;800&family=Montserrat:wght@400;500;600&display=swap');`;

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

// ---------- números tipo Nashville (I, IVm, V7...) relativos al tono original ----------
const ROMAN_MAP = ["I", "bII", "II", "bIII", "III", "IV", "#IV", "V", "bVI", "VI", "bVII", "VII"];
function chordToRoman(token, keyRoot) {
  const m = token.match(/^([A-G](?:#|b)?)([^/]*)(?:\/([A-G](?:#|b)?))?$/);
  if (!m) return token;
  const [, root, rest, bass] = m;
  const ri = noteIndex(root), ki = noteIndex(keyRoot);
  if (ri === -1 || ki === -1) return token;
  const deg = ROMAN_MAP[(ri - ki + 12) % 12];
  let out = deg + rest;
  if (bass) {
    const bi = noteIndex(bass);
    if (bi !== -1) out += "/" + ROMAN_MAP[(bi - ki + 12) % 12];
  }
  return out;
}
function romanizeLyrics(text, keyRoot) {
  if (!text) return text;
  const kr = (keyRoot || "").match(/^[A-G](?:#|b)?/)?.[0];
  if (!kr) return text;
  return text.replace(/\[([^\]]+)\]/g, (_, chord) => `[${chordToRoman(chord, kr)}]`);
}
// ---------- nombres en español (Do, Re, Mi, Fa, Sol, La, Si) ----------
const LATIN_NOTES = { C: "Do", D: "Re", E: "Mi", F: "Fa", G: "Sol", A: "La", B: "Si" };
function noteToLatin(note) {
  if (!note) return note;
  const letter = note[0];
  const accidental = note.slice(1);
  return (LATIN_NOTES[letter] || letter) + accidental;
}
function chordToLatinNotation(token) {
  const m = token.match(/^([A-G](?:#|b)?)([^/]*)(?:\/([A-G](?:#|b)?))?$/);
  if (!m) return token;
  const [, root, rest, bass] = m;
  let out = noteToLatin(root) + rest;
  if (bass) out += "/" + noteToLatin(bass);
  return out;
}
function latinizeLyrics(text) {
  if (!text) return text;
  return text.replace(/\[([^\]]+)\]/g, (_, chord) => `[${chordToLatinNotation(chord)}]`);
}
// notation: 'american' (transporta con steps), 'nashville' (números, fijo
// relativo al tono original) o 'latin' (Do, Re, Mi... transporta con steps)
function convertChart(text, songKey, steps, notation) {
  if (notation === "nashville") return romanizeLyrics(text, songKey);
  if (notation === "latin") return latinizeLyrics(transposeLyrics(text, steps));
  return transposeLyrics(text, steps);
}
// pinta un acorde separando la nota del alteración (# o b), que va más chica
// y corrida hacia abajo, como en OnStage
function renderChordChars(text) {
  const parts = text.split(/([A-G][#b])/g);
  return parts.map((part, i) => {
    const m = part.match(/^([A-G])([#b])$/);
    if (m) return <React.Fragment key={i}>{m[1]}<span className="chord-accidental">{m[2]}</span></React.Fragment>;
    return <React.Fragment key={i}>{part}</React.Fragment>;
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

// ---------- importar un texto pegado (acordes arriba de la letra, como en
// Cifra Club / Ultimate Guitar) y convertirlo a nuestro formato [Acorde]letra ----------
const CHORD_TOKEN_RE = /^[A-G](#|b)?(maj|min|dim|aug|sus|add)?\d{0,2}m?\d{0,2}(\/[A-G](#|b)?)?$/i;
const SECTION_HEADER_WORDS = [
  "intro", "introdu", "verso", "estrofa", "pre-coro", "precoro", "pre-estribillo",
  "preestribillo", "pré-refrão", "prerefrao", "refrão", "refrao", "coro", "estribillo",
  "puente", "bridge", "interludio", "interlúdio", "final", "outro", "solo", "instrumental",
  "primera parte", "segunda parte", "tercera parte", "cuarta parte", "quinta parte", "parte",
];
function isChordLine(line) {
  const t = (line || "").trim();
  if (!t) return false;
  const tokens = t.split(/\s+/);
  if (tokens.length > 14) return false;
  const chordish = tokens.filter((tok) => CHORD_TOKEN_RE.test(tok));
  return chordish.length / tokens.length >= 0.6;
}
function isSectionHeader(line) {
  const t = (line || "").trim().toLowerCase().replace(/[():]/g, "").trim();
  if (!t || isChordLine(line)) return false;
  if (t.length > 24) return false;
  return SECTION_HEADER_WORDS.some((w) => t === w || t.startsWith(w));
}
function mergeChordAndLyricLine(chordLine, lyricLine) {
  const matches = [...chordLine.matchAll(/\S+/g)];
  let result = "";
  let cursor = 0;
  matches.forEach((m) => {
    const pos = m.index;
    const chord = m[0];
    result += lyricLine.slice(cursor, pos);
    result += `[${chord}]`;
    cursor = Math.max(cursor, pos);
  });
  result += lyricLine.slice(cursor);
  return result;
}
function parsePastedChart(raw) {
  const lines = (raw || "").replace(/\r\n/g, "\n").split("\n").map((l) => l.replace(/^["'>]+\s*/, ""));
  const sections = [];
  let current = { id: uid(), name: "Letra", text: "" };
  let buffer = [];
  function flush() {
    if (buffer.length) {
      current.text = (current.text ? current.text + "\n" : "") + buffer.join("\n");
      buffer = [];
    }
  }
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isSectionHeader(line)) {
      flush();
      if (current.text.trim()) sections.push(current);
      current = { id: uid(), name: line.trim().replace(/[():]/g, ""), text: "" };
      i++;
      continue;
    }
    if (isChordLine(line)) {
      const next = lines[i + 1];
      if (next !== undefined && !isChordLine(next) && !isSectionHeader(next)) {
        buffer.push(mergeChordAndLyricLine(line, next));
        i += 2;
      } else {
        buffer.push(line.trim().split(/\s+/).map((c) => `[${c}]`).join(" "));
        i++;
      }
      continue;
    }
    buffer.push(line);
    i++;
  }
  flush();
  if (current.text.trim() || sections.length === 0) sections.push(current);
  return sections;
}
// versión liviana: solo agrega corchetes a un bloque de texto de UNA sección
// (sin dividir en secciones), para cuando se escribe/pega directo en el
// cuadro de texto sin pasar por el botón de convertir
function autoBracketSectionText(raw) {
  const lines = (raw || "").replace(/\r\n/g, "\n").split("\n").map((l) => l.replace(/^["'>]+\s*/, ""));
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.includes("[")) { out.push(line); i++; continue; }
    if (isChordLine(line)) {
      const next = lines[i + 1];
      if (next !== undefined && !isChordLine(next) && !next.includes("[")) {
        out.push(mergeChordAndLyricLine(line, next));
        i += 2;
      } else {
        out.push(line.trim().split(/\s+/).map((c) => `[${c}]`).join(" "));
        i++;
      }
      continue;
    }
    out.push(line);
    i++;
  }
  return out.join("\n");
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
  const [repertorios, setRepertorios] = useShared(tk ? tkey("repertorios") : "noop:repertorios", [], teamReady);
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
  async function toggleFavorite(id) {
    await setSongs(songs.map((s) => (s.id === id ? { ...s, favorite: !s.favorite } : s)));
  }

  async function upsertRepertorio(data) {
    if (data.id) await setRepertorios(repertorios.map((r) => (r.id === data.id ? data : r)));
    else await setRepertorios([...repertorios, { ...data, id: uid() }]);
    setScreen({ mode: "list", id: null });
  }
  async function deleteRepertorio(id) {
    if (!window.confirm("¿Borrar este repertorio?")) return;
    await setRepertorios(repertorios.filter((r) => r.id !== id));
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
          <button className="admin-btn ghost" onClick={() => setModal("prefs")}><Settings size={15} /><span>Preferencias</span></button>
          <button className="admin-btn ghost" onClick={() => setModal("help")}><HelpCircle size={15} /><span>Ayuda</span></button>
          <button className="admin-btn" onClick={tryAdmin}>{isAdmin ? <Unlock size={15} /> : <Lock size={15} />}<span>{isAdmin ? "Admin" : "Ingresar"}</span></button>
        </div>
      </header>

      {err && <div className="err-banner" onClick={() => setErr("")}>{err}</div>}

      <div className="app-body">
        <aside className="sidebar">
          <div className="sidebar-brand"><Music size={22} color="#E4B75B" /></div>
          <NavBtn icon={Home} label="Inicio" active={tab === "inicio"} onClick={() => setTab("inicio")} />
          <NavBtn icon={CalendarDays} label="Eventos" active={tab === "eventos"} onClick={() => setTab("eventos")} />
          <NavBtn icon={ListMusic} label="Canciones" active={tab === "canciones"} onClick={() => setTab("canciones")} />
          <NavBtn icon={Users} label="Equipo" active={tab === "equipo"} onClick={() => setTab("equipo")} />
          <NavBtn icon={FolderOpen} label="Recursos" active={tab === "recursos"} onClick={() => setTab("recursos")} />
          <div className="sidebar-spacer" />
          <NavBtn icon={Settings} label="Ajustes" active={false} onClick={() => setModal("prefs")} />
          <NavBtn icon={LogOut} label="Salir" active={false} onClick={handleSignOut} />
        </aside>

        <div className="app-content">
          <main className="main">
            {tab === "inicio" && (
              <Inicio
                team={currentTeam} events={sortedEvents}
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
                songs={songs} repertorios={repertorios} members={members} me={me} attendance={attendance}
                onSave={upsertEvent} onDelete={deleteEvent}
                onSetAttendance={setMyAttendance} onClaimRole={claimRole} onAssignRole={assignRole}
                requireMe={requireMe}
              />
            )}

            {tab === "canciones" && (
              <CancionesTab songs={songs} repertorios={repertorios} screen={screen} setScreen={setScreen} isAdmin={isAdmin} chordNotation={config.chordNotation || "american"}
                onSave={upsertSong} onDelete={deleteSong} onToggleFavorite={toggleFavorite}
                onSaveRepertorio={upsertRepertorio} onDeleteRepertorio={deleteRepertorio} />
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
        </div>
      </div>

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

      {modal === "prefs" && (
        <Modal onClose={() => setModal(null)}>
          <h3 className="modal-title">Preferencias</h3>
          <p className="modal-sub">Cómo se muestran los acordes en toda la biblioteca de canciones.</p>
          <div className="pref-options">
            <button className={"pref-opt" + ((config.chordNotation || "american") === "american" ? " active" : "")} onClick={() => setConfig({ ...config, chordNotation: "american" })}>
              <span className="pref-opt-title">Americano</span>
              <span className="pref-opt-sub">C, G, Am, D7</span>
            </button>
            <button className={"pref-opt" + (config.chordNotation === "nashville" ? " active" : "")} onClick={() => setConfig({ ...config, chordNotation: "nashville" })}>
              <span className="pref-opt-title">Por números</span>
              <span className="pref-opt-sub">I, IVm, V7, IIsus2</span>
            </button>
            <button className={"pref-opt" + (config.chordNotation === "latin" ? " active" : "")} onClick={() => setConfig({ ...config, chordNotation: "latin" })}>
              <span className="pref-opt-title">En español</span>
              <span className="pref-opt-sub">Do♯m7, Mibm7</span>
            </button>
          </div>
          <p className="hint" style={{ marginTop: 10 }}>Con "Por números" los acordes se muestran relativos al tono original de cada canción (sistema Nashville) — no cambian al transportar, que es lo esperado.</p>
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

function Inicio({ team, events, proximoEvento, attendance, me, members, songs, avisos, isAdmin, onSetAttendance, onGoEvent, onAddAviso, onRemoveAviso }) {
  const myStatus = attendance[me];
  const myAvail = members.find((m) => m.name === me);
  const [avisoDraft, setAvisoDraft] = useState("");
  const [copied, setCopied] = useState(false);

  const today = new Date();
  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      return d;
    });
    // eslint-disable-next-line
  }, []);
  const [selectedDate, setSelectedDate] = useState(weekDays[0].toISOString().slice(0, 10));
  const dayEvent = events.find((e) => e.date === selectedDate);
  const daySetlist = useMemo(() => {
    if (!dayEvent) return [];
    return (dayEvent.setlist || []).map((s) => {
      const song = songs.find((sg) => sg.id === s.songId);
      return { ...s, title: song?.title || s.title, key: s.key || song?.key };
    });
  }, [dayEvent, songs]);

  async function shareInvite() {
    const text = `Sumate a "${team?.name}" en Afiná con el código: ${team?.code}`;
    try {
      if (navigator.share) { await navigator.share({ title: "Afiná", text }); return; }
    } catch {}
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  }

  const songsToPrep = useMemo(() => {
    if (!proximoEvento) return [];
    return (proximoEvento.setlist || []).map((s) => {
      const song = songs.find((sg) => sg.id === s.songId);
      return { ...s, title: song?.title || s.title, key: s.key || song?.key };
    });
  }, [proximoEvento, songs]);

  return (
    <div>
      <div className="home-grid">
        <div className="card home-card">
          <span className="home-card-label">Equipo actual</span>
          <h3 className="home-card-title">{team?.name}</h3>
          <span className="muted small">{members.length} miembro{members.length !== 1 ? "s" : ""}</span>
        </div>
        <div className="card home-card">
          <span className="home-card-label">{fmtDate(selectedDate).split(",")[0]}</span>
          <div className="week-strip">
            {weekDays.map((d) => {
              const iso = d.toISOString().slice(0, 10);
              const wd = d.toLocaleDateString("es-AR", { weekday: "short" }).replace(".", "");
              const hasEvent = events.some((e) => e.date === iso);
              return (
                <button key={iso} className={"week-day" + (iso === selectedDate ? " active" : "")} onClick={() => setSelectedDate(iso)}>
                  <span className="week-day-wd">{wd}</span>
                  <span className="week-day-num">{d.getDate()}</span>
                  {hasEvent && <span className="week-day-dot" />}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {dayEvent && (
        <div className="card day-repertoire">
          <div className="home-card-label">Repertorio · {dayEvent.title}</div>
          {daySetlist.length === 0 && <p className="muted small" style={{ marginTop: 6 }}>Todavía no se cargó el repertorio de este evento.</p>}
          <div className="prep-list" style={{ marginTop: 8 }}>
            {daySetlist.map((s) => (
              <div key={s.id} className="prep-item">
                <span className="prep-title">{s.title}</span>
                {s.key && <span className="prep-key">{s.key}</span>}
                {s.prepare && <span className="prep-flag">A sacar</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="invite-banner">
        <div>
          <div className="invite-banner-title">Invitá a tu equipo</div>
          <p className="invite-banner-sub">Compartí el código y se suman en segundos.</p>
        </div>
        <button className="invite-banner-btn" onClick={shareInvite}><Copy size={14} /> {copied ? "¡Copiado!" : "Compartir código"}</button>
      </div>

      {proximoEvento && (
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

function EventosTab({ events, today, screen, setScreen, isAdmin, songs, repertorios, members, me, attendance, onSave, onDelete, onSetAttendance, onClaimRole, onAssignRole, requireMe }) {
  const [subtab, setSubtab] = useState("proximos");
  const proximos = events.filter((e) => e.date >= today);
  const pasados = [...events].filter((e) => e.date < today).reverse();
  const shown = subtab === "proximos" ? proximos : pasados;

  if (screen.mode === "form") {
    const ev = screen.id ? events.find((e) => e.id === screen.id) : null;
    return <EventForm initial={ev} songs={songs} repertorios={repertorios} members={members} onCancel={() => setScreen({ mode: ev ? "detail" : "list", id: screen.id })} onSave={onSave} />;
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
                      {s.singer && <span className="setlist-note">🎤 {s.singer}</span>}
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

function EventForm({ initial, songs, repertorios, members, onCancel, onSave }) {
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
  const [repPick, setRepPick] = useState("");
  const [formErr, setFormErr] = useState("");

  function addRole() { if (!roleDraft.trim()) return; setRoles([...roles, { id: uid(), name: roleDraft.trim(), assignedTo: "" }]); setRoleDraft(""); }
  function removeRole(id) { setRoles(roles.filter((r) => r.id !== id)); }
  function addSongFromLibrary() {
    if (!songPick) return;
    const song = songs.find((s) => s.id === songPick);
    setSetlist([...setlist, { id: uid(), songId: song.id, title: song.title, key: song.key, prepare: false, suggestedBy: "", refLink: "" }]);
    setSongPick("");
  }
  function addFromRepertorio() {
    if (!repPick) return;
    const rep = repertorios.find((r) => r.id === repPick);
    const already = new Set(setlist.map((s) => s.songId));
    const nuevas = (rep.songIds || [])
      .map((id) => songs.find((s) => s.id === id))
      .filter((s) => s && !already.has(s.id))
      .map((song) => ({ id: uid(), songId: song.id, title: song.title, key: song.key, prepare: false, suggestedBy: "", refLink: "" }));
    setSetlist([...setlist, ...nuevas]);
    setRepPick("");
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
                <select className="mini-input" value={s.singer || ""} onChange={(e) => updateSetlistItem(s.id, { singer: e.target.value })}>
                  <option value="">¿Quién la canta?</option>
                  {members.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
                </select>
                <label className="prepare-toggle"><input type="checkbox" checked={!!s.prepare} onChange={(e) => updateSetlistItem(s.id, { prepare: e.target.checked })} /> A sacar</label>
              </div>
              <input className="mini-input full" placeholder="Sugerida por" value={s.suggestedBy || ""} onChange={(e) => updateSetlistItem(s.id, { suggestedBy: e.target.value })} />
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
      {repertorios && repertorios.length > 0 && (
        <div className="add-row">
          <select className="input" value={repPick} onChange={(e) => setRepPick(e.target.value)}>
            <option value="">Cargar desde repertorio…</option>
            {repertorios.map((r) => <option key={r.id} value={r.id}>{r.name}{r.artist ? ` (${r.artist})` : ""}</option>)}
          </select>
          <button className="secondary-btn" onClick={addFromRepertorio}><ListMusic size={15} /></button>
        </div>
      )}
      {formErr && <div className="pin-error">{formErr}</div>}
      <button className="primary-btn full" onClick={submit}>{initial ? "Guardar cambios" : "Crear evento"}</button>
    </div>
  );
}

function CancionesTab({ songs, repertorios, screen, setScreen, isAdmin, chordNotation, onSave, onDelete, onToggleFavorite, onSaveRepertorio, onDeleteRepertorio }) {
  const [q, setQ] = useState("");
  const [subtab, setSubtab] = useState("biblioteca");
  const [repScreen, setRepScreen] = useState({ mode: "list", id: null });

  const base = subtab === "favoritos" ? songs.filter((s) => s.favorite) : songs;
  const filtered = base.filter((s) => s.title.toLowerCase().includes(q.toLowerCase()) || (s.artist || "").toLowerCase().includes(q.toLowerCase()));
  const grouped = useMemo(() => {
    const map = new Map();
    [...filtered].sort((a, b) => (a.artist || "zzz").localeCompare(b.artist || "zzz") || a.title.localeCompare(b.title)).forEach((s) => {
      const key = s.artist?.trim() || "Sin artista";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(s);
    });
    return Array.from(map.entries());
    // eslint-disable-next-line
  }, [filtered]);

  function changeSubtab(next) {
    setSubtab(next);
    setScreen({ mode: "list", id: null });
    setRepScreen({ mode: "list", id: null });
  }

  if (subtab === "repertorios") {
    if (repScreen.mode === "form") {
      const rep = repScreen.id ? repertorios.find((r) => r.id === repScreen.id) : null;
      return <RepertorioForm initial={rep} songs={songs} onCancel={() => setRepScreen({ mode: rep ? "detail" : "list", id: repScreen.id })} onSave={(d) => { onSaveRepertorio(d); setRepScreen({ mode: "list", id: null }); }} />;
    }
    if (repScreen.mode === "detail") {
      const rep = repertorios.find((r) => r.id === repScreen.id);
      if (!rep) return null;
      return <RepertorioDetail rep={rep} songs={songs} isAdmin={isAdmin}
        onBack={() => setRepScreen({ mode: "list", id: null })}
        onEdit={() => setRepScreen({ mode: "form", id: rep.id })}
        onDelete={() => { onDeleteRepertorio(rep.id); setRepScreen({ mode: "list", id: null }); }} />;
    }
  } else if (screen.mode === "form") {
    const song = screen.id ? songs.find((s) => s.id === screen.id) : null;
    return <SongForm initial={song} onCancel={() => setScreen({ mode: song ? "detail" : "list", id: screen.id })} onSave={onSave} />;
  } else if (screen.mode === "detail") {
    const song = songs.find((s) => s.id === screen.id);
    if (!song) return null;
    return <SongDetail song={song} isAdmin={isAdmin} chordNotation={chordNotation} onBack={() => setScreen({ mode: "list", id: null })} onEdit={() => setScreen({ mode: "form", id: song.id })} onDelete={() => onDelete(song.id)} onToggleFavorite={() => onToggleFavorite(song.id)} />;
  }

  return (
    <div>
      <div className="tabs">
        <button className={"tab" + (subtab === "biblioteca" ? " active" : "")} onClick={() => changeSubtab("biblioteca")}>Biblioteca</button>
        <button className={"tab" + (subtab === "favoritos" ? " active" : "")} onClick={() => changeSubtab("favoritos")}>Favoritos</button>
        <button className={"tab" + (subtab === "repertorios" ? " active" : "")} onClick={() => changeSubtab("repertorios")}>Repertorios</button>
      </div>

      {subtab === "repertorios" ? (
        <RepertorioList repertorios={repertorios} onOpen={(id) => setRepScreen({ mode: "detail", id })} onNew={() => setRepScreen({ mode: "form", id: null })} />
      ) : (
        <>
          <input className="input" placeholder="Buscar canción o artista…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 16 }} />
          {filtered.length === 0 && (
            <div className="empty">
              <ListMusic size={28} color="#5b628f" />
              <p>{subtab === "favoritos" ? "Todavía no marcaste canciones favoritas." : "No hay canciones cargadas."}</p>
              {subtab === "biblioteca" && <button className="primary-btn" onClick={() => setScreen({ mode: "form", id: null })}><Plus size={16} /> Agregar canción</button>}
            </div>
          )}
          {grouped.map(([artist, list]) => (
            <div key={artist} className="song-group">
              <div className="song-group-title">{artist}</div>
              <div className="song-list">
                {list.map((s) => (
                  <div key={s.id} className="song-row" onClick={() => setScreen({ mode: "detail", id: s.id })}>
                    <button className="song-fav" onClick={(e) => { e.stopPropagation(); onToggleFavorite(s.id); }}>
                      <Star size={16} fill={s.favorite ? "#E4B75B" : "none"} color={s.favorite ? "#E4B75B" : "#6b7099"} />
                    </button>
                    <div className="song-row-main">
                      <span className="song-title">{s.title}</span>
                      <div className="song-tags">{s.key && <span className="tag">{s.key}</span>}{s.bpm && <span className="tag">{s.bpm} bpm</span>}</div>
                    </div>
                    <ChevronRight size={16} color="#6b7099" />
                  </div>
                ))}
              </div>
            </div>
          ))}
          {filtered.length > 0 && <button className="fab" onClick={() => setScreen({ mode: "form", id: null })}><Plus size={24} /></button>}
        </>
      )}
    </div>
  );
}

function RepertorioList({ repertorios, onOpen, onNew }) {
  return (
    <div>
      {repertorios.length === 0 && (
        <div className="empty"><ListMusic size={28} color="#5b628f" /><p>No hay repertorios guardados todavía.</p><button className="primary-btn" onClick={onNew}><Plus size={16} /> Crear repertorio</button></div>
      )}
      <div className="song-list">
        {repertorios.map((r) => (
          <div key={r.id} className="song-row" onClick={() => onOpen(r.id)}>
            <div className="song-row-main">
              <span className="song-title">{r.name}</span>
              <div className="song-tags">{r.artist && <span className="tag">{r.artist}</span>}<span className="tag">{(r.songIds || []).length} canciones</span></div>
            </div>
            <ChevronRight size={16} color="#6b7099" />
          </div>
        ))}
      </div>
      {repertorios.length > 0 && <button className="fab" onClick={onNew}><Plus size={24} /></button>}
    </div>
  );
}

function RepertorioDetail({ rep, songs, isAdmin, onBack, onEdit, onDelete }) {
  const list = (rep.songIds || []).map((id) => songs.find((s) => s.id === id)).filter(Boolean);
  return (
    <div>
      <button className="back-btn" onClick={onBack}><ArrowLeft size={16} /> Volver</button>
      <div className="card detail-head">
        <div className="detail-body">
          <div className="detail-top">
            <span className="badge" style={{ background: "#7C93C726", color: "#7C93C7", borderColor: "#7C93C766" }}>Repertorio</span>
            <div className="icon-row"><button className="icon-btn" onClick={onEdit}><Pencil size={15} /></button><button className="icon-btn" onClick={onDelete}><Trash2 size={15} /></button></div>
          </div>
          <h2>{rep.name}</h2>
          {rep.artist && <div className="meta">{rep.artist}</div>}
          <p className="hint" style={{ marginTop: 10 }}>Para usarlo en un servicio o ensayo, andá al evento y tocá "Cargar desde repertorio" al armar el repertorio.</p>
        </div>
      </div>
      <Section title="Canciones" icon={<ListMusic size={16} />}>
        {list.length === 0 && <p className="muted">Este repertorio todavía no tiene canciones.</p>}
        <div className="setlist">
          {list.map((s, i) => (
            <div key={s.id} className="setlist-item">
              <span className="setlist-num">{i + 1}</span>
              <div className="setlist-info"><span className="setlist-title">{s.title}</span>{s.key && <span className="setlist-key">{s.key}</span>}</div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function RepertorioForm({ initial, songs, onCancel, onSave }) {
  const [name, setName] = useState(initial?.name || "");
  const [artist, setArtist] = useState(initial?.artist || "");
  const [songIds, setSongIds] = useState(initial?.songIds || []);
  const [q, setQ] = useState("");
  const [formErr, setFormErr] = useState("");

  function toggle(id) { setSongIds(songIds.includes(id) ? songIds.filter((i) => i !== id) : [...songIds, id]); }
  function submit() {
    if (!name.trim()) { setFormErr("Poné un nombre para el repertorio."); return; }
    onSave({ id: initial?.id, name: name.trim(), artist: artist.trim(), songIds });
  }
  const filtered = songs.filter((s) => s.title.toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <button className="back-btn" onClick={onCancel}><ArrowLeft size={16} /> Cancelar</button>
      <h2 className="form-title">{initial ? "Editar repertorio" : "Nuevo repertorio"}</h2>
      <label className="label">Nombre</label>
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Repertorio de Navidad" />
      <label className="label">Artista (opcional)</label>
      <input className="input" value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Ej: Miel San Marcos" />
      <label className="label">Canciones ({songIds.length} elegidas)</label>
      <input className="input" placeholder="Buscar canción…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 8 }} />
      <div className="rep-song-pick">
        {filtered.map((s) => (
          <label key={s.id} className="rep-song-pick-row">
            <input type="checkbox" checked={songIds.includes(s.id)} onChange={() => toggle(s.id)} />
            <span>{s.title}</span>{s.artist && <span className="muted small">· {s.artist}</span>}
          </label>
        ))}
        {filtered.length === 0 && <p className="muted small">No hay canciones que coincidan.</p>}
      </div>
      {formErr && <div className="pin-error">{formErr}</div>}
      <button className="primary-btn full" onClick={submit}>{initial ? "Guardar cambios" : "Crear repertorio"}</button>
    </div>
  );
}

function SongDetail({ song, isAdmin, chordNotation, onBack, onEdit, onDelete, onToggleFavorite }) {
  const [steps, setSteps] = useState(0);
  const [keyPicker, setKeyPicker] = useState(false);
  const [perfMode, setPerfMode] = useState(false);
  const [fontSize, setFontSize] = useState(15);
  const [hideChords, setHideChords] = useState(false);
  const displayKey = steps ? transposeChordToken(song.key || "", steps) : (song.key || "");
  const displayKeyLabel = chordNotation === "latin" ? chordToLatinNotation(displayKey) : displayKey;
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
            <div className="icon-row">
              <button className="icon-btn" onClick={onToggleFavorite}><Star size={15} fill={song.favorite ? "#E4B75B" : "none"} color={song.favorite ? "#E4B75B" : "#5b6088"} /></button>
              <button className={"icon-btn perf-trigger" + (hideChords ? " active" : "")} onClick={() => setHideChords(!hideChords)}>{hideChords ? <EyeOff size={15} /> : <Eye size={15} />} {hideChords ? "Mostrar acordes" : "Solo letra"}</button>
              <button className="icon-btn perf-trigger" onClick={() => setPerfMode(true)}><Presentation size={15} /> Modo directo</button>
              <button className="icon-btn" onClick={onEdit}><Pencil size={15} /></button>
              <button className="icon-btn" onClick={onDelete}><Trash2 size={15} /></button>
            </div>
          </div>
          <h2>{song.title}</h2>
          <div className="meta">{song.artist && <span>{song.artist}</span>}{song.bpm && <span>{song.artist ? "· " : ""}{song.bpm} BPM</span>}</div>

          <button className="cc-tono-btn" onClick={() => setKeyPicker(!keyPicker)}>
            Tono: <span className="cc-tono-value">{displayKeyLabel || "—"}</span>
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
                  <button key={s.id} className="section-chip" style={{ borderColor: m.color, color: m.color }} onClick={() => jumpTo(i)}>
                    {m.abbr}{s.repeat > 1 && <span className="chip-repeat">x{s.repeat}</span>}
                  </button>
                );
              })}
            </div>
          )}

          <div className="song-desc">{song.description || "Sin descripción"}</div>

          <div className="fontsize-row">
            <span className="label" style={{ margin: 0 }}>Tamaño de letra</span>
            <div className="fontsize-btns">
              <button className="cc-arrow small" onClick={() => setFontSize((f) => Math.max(11, f - 1))}>A-</button>
              <button className="cc-arrow small" onClick={() => setFontSize((f) => Math.min(26, f + 1))}>A+</button>
            </div>
          </div>
        </div>
      </div>

      {sections.map((s, i) => {
        const m = sectionMeta(s.name);
        const text = convertChart(s.text || "", song.key, steps, chordNotation);
        return (
          <div key={s.id} ref={refs[i]} className="section-block">
            <span className="section-pill" style={{ background: m.color + "26", color: m.color, borderColor: m.color + "66" }}>
              <span className="section-pill-abbr" style={{ borderColor: m.color }}>{m.abbr}</span> {s.name}{s.repeat > 1 && <span className="pill-repeat">x{s.repeat}</span>}
            </span>
            <div className="chordchart" style={{ fontSize: fontSize + "px" }}>
              {text.split("\n").map((line, li) => {
                const { chords, lyrics } = splitChordLine(line);
                return (
                  <div key={li} className="chordchart-line">
                    {!hideChords && chords.trim() && <div className="chordchart-chords">{renderChordChars(chords)}</div>}
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

      {perfMode && <PerformanceMode song={song} sections={sections} steps={steps} chordNotation={chordNotation} onClose={() => setPerfMode(false)} />}
    </div>
  );
}

const TIME_SIGS = ["4/4", "3/4", "2/4", "6/8", "2/2"];
function beatsForSig(sig) { return Number((sig || "4/4").split("/")[0]) || 4; }

function useMetronome(bpm, beatsPerMeasure, running, audioCtxRef) {
  const [beat, setBeat] = useState(0);
  const intervalRef = useRef(null);

  function click(accent) {
    try {
      const ctx = audioCtxRef.current;
      if (!ctx) return;
      if (ctx.state === "suspended") ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = accent ? 1050 : 720;
      gain.gain.setValueAtTime(0.5, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.06);
    } catch {}
  }

  useEffect(() => {
    if (!running) { if (intervalRef.current) clearInterval(intervalRef.current); setBeat(0); return; }
    let count = 0;
    setBeat(0);
    click(true);
    const ms = 60000 / (bpm || 120);
    intervalRef.current = setInterval(() => {
      count = (count + 1) % beatsPerMeasure;
      setBeat(count);
      click(count === 0);
    }, ms);
    return () => clearInterval(intervalRef.current);
    // eslint-disable-next-line
  }, [running, bpm, beatsPerMeasure]);

  return beat;
}

function PerformanceMode({ song, sections, steps, chordNotation, onClose }) {
  const [speed, setSpeed] = useState(1);
  const [scrolling, setScrolling] = useState(false);
  const [fontSize, setFontSize] = useState(19);
  const [hideChords, setHideChords] = useState(false);
  const [metroOn, setMetroOn] = useState(false);
  const [bpm, setBpm] = useState(Number(song.bpm) > 0 ? Number(song.bpm) : 120);
  const [timeSig, setTimeSig] = useState("4/4");
  const beatsPerMeasure = beatsForSig(timeSig);
  const audioCtxRef = useRef(null);
  const currentBeat = useMetronome(bpm, beatsPerMeasure, metroOn, audioCtxRef);
  const containerRef = useRef(null);
  const rafRef = useRef(null);

  // el navegador (sobre todo en el celular) solo deja "destrabar" el sonido
  // si el AudioContext se crea justo en el toque del bot\u00f3n, no despu\u00e9s
  function toggleMetro() {
    if (!metroOn) {
      try {
        if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
        const ctx = audioCtxRef.current;
        if (ctx.state === "suspended") ctx.resume();
        // truco cl\u00e1sico para "destrabar" audio en iOS: reproducir un buffer
        // silencioso real (m\u00e1s confiable que un oscilador solo)
        const buffer = ctx.createBuffer(1, 1, 22050);
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(ctx.destination);
        src.start(0);
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0.0001;
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.01);
      } catch {}
    }
    setMetroOn(!metroOn);
  }
  const scrollAccRef = useRef(0);
  const refs = useMemo(() => sections.map(() => React.createRef()), [sections.length]);

  useEffect(() => {
    if (!scrolling) { if (rafRef.current) cancelAnimationFrame(rafRef.current); return; }
    scrollAccRef.current = containerRef.current ? containerRef.current.scrollTop : 0;
    function step() {
      if (containerRef.current) {
        scrollAccRef.current += 0.5 * speed;
        containerRef.current.scrollTop = scrollAccRef.current;
        const el = containerRef.current;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) setScrolling(false);
      }
      rafRef.current = requestAnimationFrame(step);
    }
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [scrolling, speed]);

  function jumpTo(i) { refs[i]?.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }

  return (
    <div className="perf-overlay">
      <div className="perf-header">
        <button className="perf-close" onClick={onClose}><X size={20} /></button>
        <div className="perf-title">{song.title}{song.key ? ` · ${transposeChordToken(song.key, steps)}` : ""}</div>
        <div className="perf-controls">
          <button className={"cc-arrow small" + (hideChords ? " active" : "")} onClick={() => setHideChords(!hideChords)}>{hideChords ? <EyeOff size={13} /> : <Eye size={13} />}</button>
          <div className="fontsize-btns">
            <button className="cc-arrow small" onClick={() => setFontSize((f) => Math.max(13, f - 1))}>A-</button>
            <button className="cc-arrow small" onClick={() => setFontSize((f) => Math.min(32, f + 1))}>A+</button>
          </div>
        </div>
      </div>

      <div className="perf-speed-row">
        <span className="perf-speed-label">Velocidad</span>
        <input
          className="perf-speed-slider"
          type="range" min="0.25" max="2.75" step="0.25"
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
        />
        <span className="perf-speed-value">{speed.toFixed(2).replace(/\.?0+$/, "") || speed}x</span>
      </div>

      <div className="perf-metro-row">
        <button className={"perf-metro-btn" + (metroOn ? " active" : "")} onClick={toggleMetro}>
          {metroOn ? <Square size={13} /> : <Play size={13} />} Metrónomo
        </button>
        <div className="perf-metro-dots">
          {Array.from({ length: beatsPerMeasure }, (_, i) => (
            <span key={i} className={"perf-metro-dot" + (metroOn && currentBeat === i ? " on" : "") + (i === 0 ? " accent" : "")} />
          ))}
        </div>
        <div className="perf-metro-field">
          <button className="cc-arrow small" onClick={() => setBpm((b) => Math.max(30, b - 1))}>−</button>
          <span className="perf-metro-bpm">{bpm} <span className="perf-metro-bpm-label">BPM</span></span>
          <button className="cc-arrow small" onClick={() => setBpm((b) => Math.min(300, b + 1))}>+</button>
        </div>
        <select className="perf-metro-sig" value={timeSig} onChange={(e) => setTimeSig(e.target.value)}>
          {TIME_SIGS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {sections.length > 0 && (
        <div className="perf-section-nav">
          {sections.map((s, i) => {
            const m = sectionMeta(s.name);
            return (
              <button key={s.id} className="section-chip" style={{ borderColor: m.color, color: m.color }} onClick={() => jumpTo(i)}>
                {m.abbr}{s.repeat > 1 && <span className="chip-repeat">x{s.repeat}</span>}
              </button>
            );
          })}
        </div>
      )}

      <div className="perf-body" ref={containerRef}>
        {sections.map((s, i) => {
          const m = sectionMeta(s.name);
          const text = convertChart(s.text || "", song.key, steps, chordNotation);
          return (
            <div key={s.id} ref={refs[i]} className="section-block">
              <span className="section-pill" style={{ background: m.color + "26", color: m.color, borderColor: m.color + "66" }}>
                <span className="section-pill-abbr" style={{ borderColor: m.color }}>{m.abbr}</span> {s.name}{s.repeat > 1 && <span className="pill-repeat">x{s.repeat}</span>}
              </span>
              <div className="chordchart perf-chart" style={{ fontSize: fontSize + "px" }}>
                {text.split("\n").map((line, li) => {
                  const { chords, lyrics } = splitChordLine(line);
                  return (
                    <div key={li} className="chordchart-line">
                      {!hideChords && chords.trim() && <div className="chordchart-chords perf-chords">{renderChordChars(chords)}</div>}
                      <div className="chordchart-lyrics perf-lyrics">{lyrics || "\u00A0"}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <button className={"perf-play-fab" + (scrolling ? " active" : "")} onClick={() => setScrolling(!scrolling)}>
        {scrolling ? <Square size={26} /> : <Play size={26} />}
      </button>
    </div>
  );
}

function SongForm({ initial, onCancel, onSave }) {
  const [title, setTitle] = useState(initial?.title || "");
  const [artist, setArtist] = useState(initial?.artist || "");
  const [key, setKey] = useState(initial?.key || "");
  const [bpm, setBpm] = useState(initial?.bpm || "");
  const [description, setDescription] = useState(initial?.description || initial?.structure || "");
  const [sections, setSections] = useState(initial?.sections?.length ? initial.sections : (initial?.lyrics ? [{ id: uid(), name: "Letra", text: initial.lyrics }] : [{ id: uid(), name: "Estrofa", text: "" }]));
  const [links, setLinks] = useState(initial?.links || []);
  const [linkDraft, setLinkDraft] = useState({ label: "", url: "" });
  const [formErr, setFormErr] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  function addSection() { setSections([...sections, { id: uid(), name: "Coro", text: "", repeat: 1 }]); }
  function updateSection(id, patch) { setSections(sections.map((s) => (s.id === id ? { ...s, ...patch } : s))); }
  function removeSection(id) { setSections(sections.filter((s) => s.id !== id)); }
  function moveSection(id, dir) {
    const i = sections.findIndex((s) => s.id === id);
    const j = i + dir;
    if (j < 0 || j >= sections.length) return;
    const next = [...sections];
    [next[i], next[j]] = [next[j], next[i]];
    setSections(next);
  }
  function addLink() { if (!linkDraft.url.trim()) return; setLinks([...links, { ...linkDraft }]); setLinkDraft({ label: "", url: "" }); }
  function removeLink(i) { setLinks(links.filter((_, idx) => idx !== i)); }
  function convertPaste() {
    if (!pasteText.trim()) return;
    setSections(parsePastedChart(pasteText));
    setPasteText("");
    setPasteOpen(false);
  }
  function submit() {
    if (!title.trim()) { setFormErr("Poné al menos un título."); return; }
    onSave({ id: initial?.id, title: title.trim(), artist: artist.trim(), key: key.trim(), bpm: bpm.trim(), description: description.trim(), sections: sections.map((s) => ({ ...s, text: autoBracketSectionText(s.text) })), links, favorite: initial?.favorite || false });
  }

  return (
    <div>
      <button className="back-btn" onClick={onCancel}><ArrowLeft size={16} /> Cancelar</button>
      <h2 className="form-title">{initial ? "Editar canción" : "Nueva canción"}</h2>
      <label className="label">Título</label>
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sublime gracia" />
      <label className="label">Artista</label>
      <input className="input" value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Ej: Miel San Marcos" />
      <div className="row2">
        <div style={{ flex: 1 }}><label className="label">Tonalidad original</label><input className="input" value={key} onChange={(e) => setKey(e.target.value)} placeholder="G" /></div>
        <div style={{ flex: 1 }}><label className="label">BPM</label><input className="input" value={bpm} onChange={(e) => setBpm(e.target.value)} placeholder="72" /></div>
      </div>
      <label className="label">Descripción (opcional)</label>
      <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Notas generales de la canción" />

      <label className="label">Secciones</label>
      <p className="hint">Escribí los acordes entre corchetes en cada línea, ej: [G]Sublime [C]gracia. Usá nombres como Intro, Estrofa, Preestribillo, Coro, Interludio, Puente — así se colorean solos.</p>

      {!pasteOpen ? (
        <button className="secondary-btn" style={{ marginBottom: 12 }} onClick={() => setPasteOpen(true)}><ClipboardPaste size={15} /> Pegar desde otra página (autocompletar)</button>
      ) : (
        <div className="paste-box">
          <p className="hint" style={{ marginTop: 0 }}>Copiá el texto de la página (con los acordes arriba de cada línea de letra) y pegalo acá. Convierte automático — después revisá que haya quedado bien.</p>
          <textarea className="input textarea tall" value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder={"Pegá acá el texto copiado…"} />
          <div className="add-row" style={{ marginTop: 8 }}>
            <button className="primary-btn" style={{ marginTop: 0 }} onClick={convertPaste}><ClipboardPaste size={15} /> Convertir automáticamente</button>
            <button className="secondary-btn" onClick={() => { setPasteOpen(false); setPasteText(""); }}>Cancelar</button>
          </div>
        </div>
      )}

      {sections.map((s, i) => {
        const m = sectionMeta(s.name);
        return (
          <div key={s.id} className="section-edit-block">
            <div className="section-edit-head">
              <span className="section-pill-abbr small" style={{ borderColor: m.color, color: m.color }}>{m.abbr}</span>
              <input className="input" style={{ flex: 1 }} value={s.name} onChange={(e) => updateSection(s.id, { name: e.target.value })} placeholder="Nombre de la sección" />
              <span className="repeat-field">
                <span>x</span>
                <input type="number" min="1" className="mini-input repeat-input" value={s.repeat || 1} onChange={(e) => updateSection(s.id, { repeat: Math.max(1, Number(e.target.value) || 1) })} />
              </span>
              <button className="icon-btn-sm" disabled={i === 0} onClick={() => moveSection(s.id, -1)}><ArrowUpCircle size={14} /></button>
              <button className="icon-btn-sm" disabled={i === sections.length - 1} onClick={() => moveSection(s.id, 1)}><ArrowDownCircle size={14} /></button>
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
  @font-face {
    font-family: 'WestCoast';
    src: url(data:font/truetype;charset=utf-8;base64,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AGgAIABTAGMAYQBuAGEAaABhAG4AZAAuACAAQwBvAHAAeQByAGkAZwBoAHQAIACpACAARgBvAG4AdABQAGEAbgBkAGEALgBjAG8AbQAgADIAMAAxADMALgAgAEEAbABsACAAUgBpAGcAaAB0AHMAIABSAGUAcwBlAHIAdgBlAGQALgBSAGUAZwB1AGwAYQByADQALgAwAC4AMQA1ADEAOwBTADEANgAyADAANAAyADUAOAA4ADQAOwBIAEwAOwA3ADMAOAAyADEANQA0ADsAXwBXAGUAcwB0AEMAbwBhAHMAdABfADoAVgBlAHIAcwBpAG8AbgAgADEALgAwADAAVgBlAHIAcwBpAG8AbgAgADEALgAwADAAIABNAGEAeQAgADEAOQAsACAAMgAwADEAMwAsACAAaQBuAGkAdABpAGEAbAAgAHIAZQBsAGUAYQBzAGUAVABoAGkAcwAgAGYAbwBuAHQAIAB3AGEAcwAgAGMAcgBlAGEAdABlAGQAIAB1AHMAaQBuAGcAIABTAGMAYQBuAGEAaABhAG4AZAAgAGYAcgBvAG0AIABIAGkAZwBoAC0ATABvAGcAaQBjAC4AYwBvAG0AAgAAAAAAAP8nAJYAAAAAAAAAAAAAAAAAAAAAAAAAAAB0AAAAAQACAAMABAAFAAYABwAIAAkACgALAAwADQAOAA8AEAARABIAEwAUABUAFgAXABgAGQAaABsAHAAdAB4AHwAgACEAIgAjACQAJQAmACcAKAApACoAKwAsAC0ALgAvADAAMQAyADMANAA1ADYANwA4ADkAOgA7ADwAPQA+AD8AQABBAEIAQwBEAEUARgBHAEgASQBKAEsATABNAE4ATwBQAFEAUgBTAFQAVQBWAFcAWABZAFoAWwBcAF0AXgBfAGAAYQCOAJMAjQDeANgA4QDbANwA3QDgANkA3wC2ALcAtAC1AIcAqwAAAAAAAf//AAI=) format('truetype');
    font-weight: normal;
    font-style: normal;
    font-display: swap;
  }
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
  .mini-input.full { width:100%; margin-bottom:6px; }
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
  .home-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:14px; }
  .home-card { padding:16px; background:#232853; border:1px solid #2E3358; }
  .home-card-label { font-size:12px; color:#9aa2c9; font-weight:600; }
  .home-card-title { font-family:'Fraunces',serif; font-size:20px; color:#FBF7EC; margin:6px 0 4px; }
  .week-strip { display:flex; justify-content:space-between; gap:4px; margin-top:10px; }
  .week-day { display:flex; flex-direction:column; align-items:center; gap:3px; padding:6px 4px; border-radius:10px; color:#c7cbe8; position:relative; flex:1; }
  .week-day.active { background:#E4B75B; color:#1B1F3B; }
  .week-day-wd { font-size:10px; text-transform:uppercase; opacity:.8; }
  .week-day-num { font-size:15px; font-weight:700; }
  .week-day-dot { width:4px; height:4px; border-radius:50%; background:#8FB88F; position:absolute; bottom:2px; }
  .week-day.active .week-day-dot { background:#1B1F3B; }
  .day-repertoire { padding:16px; margin-bottom:14px; background:#232853; border:1px solid #2E3358; }
  .invite-banner { display:flex; align-items:center; justify-content:space-between; gap:14px; background:linear-gradient(135deg,#2E5FE0,#1B3FA8); border-radius:14px; padding:18px 20px; margin-bottom:14px; flex-wrap:wrap; }
  .invite-banner-title { font-family:'Fraunces',serif; font-size:17px; font-weight:700; color:#fff; }
  .invite-banner-sub { font-size:13px; color:#cfd8ff; margin-top:2px; }
  .invite-banner-btn { display:flex; align-items:center; gap:7px; background:#fff; color:#1B3FA8; padding:9px 16px; border-radius:10px; font-size:13px; font-weight:700; white-space:nowrap; }
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
  .song-fav { display:flex; padding:2px; flex-shrink:0; }
  .song-group { margin-bottom:18px; }
  .song-group-title { font-size:12px; font-weight:700; color:#9aa2c9; text-transform:uppercase; letter-spacing:.5px; margin-bottom:8px; }
  .rep-song-pick { display:flex; flex-direction:column; gap:2px; max-height:320px; overflow-y:auto; background:#232853; border-radius:10px; padding:8px; }
  .rep-song-pick-row { display:flex; align-items:center; gap:8px; padding:8px 6px; font-size:14px; border-radius:8px; }
  .rep-song-pick-row:hover { background:#1B1F3B; }
  .transpose-row { display:flex; align-items:center; gap:14px; }
  .key-display { font-family:'Fraunces',serif; font-size:26px; font-weight:700; color:#E4B75B; min-width:44px; text-align:center; }
  .lyrics { background:#232853; border-radius:12px; padding:16px 18px; font-family:'Work Sans',monospace; font-size:14px; line-height:1.9; }
  .lyrics-line { white-space:pre-wrap; }
  .chord { color:#E4B75B; font-weight:700; }
  .transpose-cc-row { display:flex; align-items:center; gap:10px; margin-top:14px; }
  .cc-arrow { background:#232853; color:#E4B75B; width:34px; height:34px; border-radius:50%; font-size:20px; display:flex; align-items:center; justify-content:center; }
  .cc-arrow.small { width:auto; height:32px; padding:0 10px; border-radius:8px; font-size:13px; font-weight:700; }
  .cc-arrow.active { background:#E4B75B; color:#1B1F3B; }
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
  .fontsize-row { display:flex; align-items:center; justify-content:space-between; margin-top:12px; }
  .fontsize-btns { display:flex; gap:6px; }
  .section-block { margin-top:20px; scroll-margin-top:16px; }
  .section-pill { display:inline-flex; align-items:center; gap:8px; font-size:13px; font-weight:700; padding:5px 12px 5px 5px; border-radius:20px; border:1px solid; margin-bottom:8px; }
  .section-pill-abbr { display:flex; align-items:center; justify-content:center; width:22px; height:22px; border-radius:50%; border:1.5px solid; font-size:10px; background:#1B1F3B; }
  .section-pill-abbr.small { width:26px; height:26px; border-radius:8px; font-size:11px; background:#232853; flex-shrink:0; }
  .chordchart { background:#232853; border-radius:12px; padding:14px 16px; font-family:'Work Sans',sans-serif; font-size:13px; }
  .chordchart-line { margin-bottom:4px; }
  .chordchart-chords { color:#fff; font-family:'WestCoast','Manrope',sans-serif; font-weight:700; font-size:1.55em; white-space:pre; line-height:1.3; }
  .chord-accidental { font-size:1.1em; vertical-align:-0.22em; margin:0 -0.02em; }
  .chordchart-lyrics { color:#c7cbe8; font-family:'Montserrat',sans-serif; font-size:16px; white-space:pre; line-height:1.6; }
  .perf-trigger { background:#E4B75B26; color:#E4B75B; padding:7px 12px; width:auto; gap:6px; font-size:12px; font-weight:700; }
  .perf-trigger.active { background:#C97C87; color:#1B1F3B; }
  .perf-overlay { position:fixed; top:0; right:0; bottom:0; left:0; height:100vh; height:100dvh; background:#0F1128; z-index:200; display:flex; flex-direction:column; overflow:hidden; }
  .perf-header { display:flex; align-items:center; gap:12px; padding:14px 16px; border-bottom:1px solid #2E3358; flex-wrap:wrap; }
  .perf-close { background:#232853; color:#EDEBFA; width:36px; height:36px; border-radius:50%; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
  .perf-title { flex:1; font-family:'Fraunces',serif; font-size:17px; font-weight:700; color:#FBF7EC; min-width:120px; }
  .perf-controls { display:flex; align-items:center; gap:8px; }
  .perf-speed-row { display:flex; align-items:center; gap:10px; padding:0 16px 12px; flex-shrink:0; }
  .perf-speed-label { font-size:12px; color:#9aa2c9; white-space:nowrap; }
  .perf-speed-slider { flex:1; accent-color:#E4B75B; }
  .perf-speed-value { font-size:13px; font-weight:700; color:#E4B75B; min-width:38px; text-align:right; }
  .perf-metro-row { display:flex; align-items:center; gap:10px; padding:0 16px 14px; flex-wrap:wrap; flex-shrink:0; border-bottom:1px solid #2E3358; padding-bottom:14px; }
  .perf-metro-btn { display:flex; align-items:center; gap:6px; background:#232853; color:#EDEBFA; padding:8px 12px; border-radius:8px; font-size:12px; font-weight:700; }
  .perf-metro-btn.active { background:#E4B75B; color:#1B1F3B; }
  .perf-metro-dots { display:flex; gap:5px; }
  .perf-metro-dot { width:9px; height:9px; border-radius:50%; background:#3a4066; }
  .perf-metro-dot.accent { background:#5b6088; }
  .perf-metro-dot.on { background:#E4B75B; }
  .perf-metro-field { display:flex; align-items:center; gap:6px; }
  .perf-metro-bpm { font-family:'Fraunces',serif; font-size:15px; font-weight:700; color:#EDEBFA; min-width:56px; text-align:center; }
  .perf-metro-bpm-label { font-size:10px; color:#9aa2c9; font-family:'Work Sans',sans-serif; font-weight:600; }
  .perf-metro-sig { background:#232853; color:#EDEBFA; border:1px solid #3a4066; border-radius:8px; padding:7px 8px; font-size:12px; font-weight:600; }
  .perf-play-fab { position:fixed; top:50%; right:20px; transform:translateY(-50%); width:64px; height:64px; border-radius:50%; background:#E4B75B; color:#1B1F3B; display:flex; align-items:center; justify-content:center; box-shadow:0 10px 30px rgba(0,0,0,0.5); z-index:210; opacity:0.5; }
  .perf-play-fab.active { background:#C97C87; opacity:0.9; }
  .perf-play-fab:active { opacity:1; }
  .perf-section-nav { display:flex; gap:8px; overflow-x:auto; padding:10px 16px; border-bottom:1px solid #2E3358; flex-shrink:0; }
  .perf-body { flex:1; min-height:0; overflow-y:auto; -webkit-overflow-scrolling:touch; padding:20px 24px 60px; max-width:720px; margin:0 auto; width:100%; }
  .perf-chart { background:transparent; padding:0; font-size:19px; }
  .perf-chords { font-size:19px; }
  .perf-lyrics { font-size:19px; }
  .section-edit-block { background:#232853; border-radius:10px; padding:10px; margin-bottom:10px; }
  .paste-box { background:#232853; border:1px dashed #3a4066; border-radius:10px; padding:12px; margin-bottom:14px; }
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
  .app-body { display:flex; }
  .app-content { flex:1; min-width:0; }
  .sidebar { display:none; }
  .bottom-nav { position:fixed; bottom:0; left:0; right:0; background:#171a33; border-top:1px solid #2E3358; display:flex; justify-content:space-around; padding:8px 4px calc(8px + env(safe-area-inset-bottom)); z-index:30; }
  .nav-btn { display:flex; flex-direction:column; align-items:center; gap:3px; color:#6b7099; font-size:10px; font-weight:600; padding:4px 8px; border-radius:10px; }
  .nav-btn.active { color:#E4B75B; }
  .chip-repeat, .pill-repeat { font-size:9px; margin-left:2px; opacity:.85; }
  .repeat-field { display:flex; align-items:center; gap:3px; font-size:12px; color:#c7cbe8; }
  .repeat-input { width:36px; text-align:center; }
  .pref-options { display:flex; flex-direction:column; gap:8px; margin-top:6px; }
  .pref-opt { display:flex; flex-direction:column; align-items:flex-start; gap:2px; background:#1B1F3B; border:1px solid #3a4066; padding:12px 14px; border-radius:10px; text-align:left; }
  .pref-opt.active { border-color:#E4B75B; background:#E4B75B1a; }
  .pref-opt-title { font-weight:700; color:#EDEBFA; font-size:14px; }
  .pref-opt-sub { font-size:12px; color:#9aa2c9; font-family:'Work Sans',monospace; }
  @media (max-width:480px){ .grid{ grid-template-columns:1fr; } .row2{ flex-direction:column; } .home-grid{ grid-template-columns:1fr; } .chordchart-chords{ font-size:1.8em; } .chord-accidental{ font-size:1.15em; } }
  @media (min-width:900px){
    .bottom-nav { display:none; }
    .app-footer { display:none; }
    .afina-app { padding-bottom:0; }
    .sidebar { display:flex; flex-direction:column; align-items:center; gap:6px; width:88px; flex-shrink:0; background:#171a33; border-right:1px solid #2E3358; min-height:calc(100vh - 57px); padding:18px 6px; }
    .sidebar-brand { margin-bottom:10px; }
    .sidebar-spacer { flex:1; }
    .sidebar .nav-btn { width:100%; padding:10px 4px; font-size:10px; }
    .main { max-width:960px; }
  }
`;
