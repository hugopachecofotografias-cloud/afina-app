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
  const lines = (raw || "").replace(/\r\n/g, "\n").split("\n").map((l) => l.replace(/^["'>]+\s*/, "").replace(/[[\]]/g, ""));
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
  // si quedaron dos secciones seguidas con el mismo nombre (pasa cuando la
  // página repite el encabezado con solo un acorde suelto en el medio),
  // las unimos en una sola
  const merged = [];
  sections.forEach((s) => {
    const prev = merged[merged.length - 1];
    if (prev && prev.name.trim().toLowerCase() === s.name.trim().toLowerCase()) {
      prev.text = (prev.text ? prev.text + "\n" : "") + s.text;
    } else {
      merged.push(s);
    }
  });
  return merged;
}
// versión liviana: solo agrega corchetes a un bloque de texto de UNA sección
// (sin dividir en secciones), para cuando se escribe/pega directo en el
// cuadro de texto sin pasar por el botón de convertir
function autoBracketSectionText(raw) {
  const lines = (raw || "").replace(/\r\n/g, "\n").split("\n").map((l) => l.replace(/^["'>]+\s*/, "").replace(/[[\]]/g, ""));
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
                onOpenSong={(songId) => { setTab("canciones"); setScreen({ mode: "detail", id: songId }); }}
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

function EventosTab({ events, today, screen, setScreen, isAdmin, songs, repertorios, members, me, attendance, onSave, onDelete, onSetAttendance, onClaimRole, onAssignRole, requireMe, onOpenSong }) {
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
        onOpenSong={onOpenSong}
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

function EventDetail({ ev, songs, members, isAdmin, me, attendance, onBack, onEdit, onDelete, onOpenSong, onSetAttendance, onClaimRole, onAssignRole, requireMe }) {
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
                <div key={s.id} className={"setlist-item" + (song ? " clickable" : "")} onClick={() => song && onOpenSong(song.id)}>
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
                  {song && <ChevronRight size={15} color="#6b7099" />}
                  {(s.refLink || song?.links?.[0]?.url) && (
                    <a href={s.refLink || song.links[0].url} target="_blank" rel="noreferrer" className="setlist-link" onClick={(e) => e.stopPropagation()}><LinkIcon size={13} /></a>
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
    font-family: 'OneSignature';
    src: url(data:font/truetype;charset=utf-8;base64,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) format('truetype');
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
  .setlist-item.clickable { cursor:pointer; }
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
  .chordchart-chords { color:#fff; font-family:Arial,'Manrope',sans-serif; font-weight:700; font-size:1.4em; white-space:pre; line-height:1.3; }
  .chord-accidental { font-size:0.55em; vertical-align:sub; margin:0 -0.02em; }
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
  @media (max-width:480px){ .grid{ grid-template-columns:1fr; } .row2{ flex-direction:column; } .home-grid{ grid-template-columns:1fr; } .chordchart-chords{ font-size:1.8em; } .chord-accidental{ font-size:0.55em; } }
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
