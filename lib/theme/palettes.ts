export type PaletteId = "violet" | "vinyl" | "oxblood" | "steel" | "forest" | "afterglow";
export type Theme = "dark" | "light";

export interface PalettePreview {
  bg: string;
  surf: string;
  line: string;
  t1: string;
  t2: string;
  t3: string;
  acc: string;
  onAcc: string;
  playing: string;
  hatchA: string;
  hatchB: string;
}

export interface PaletteDef {
  id: PaletteId;
  name: string;
  tag: string;
  hues: string;
  dark: PalettePreview;
  light: PalettePreview;
}

export const PALETTE_IDS: PaletteId[] = ["violet", "vinyl", "oxblood", "steel", "forest", "afterglow"];

export const PALETTES: PaletteDef[] = [
  {
    id: "violet",
    name: "Ultraviolet Dub",
    tag: "night-club dark, one saturated hue",
    hues: "ink violet · electric iris · pale lilac",
    dark: {
      bg: "#121016",
      surf: "#1A1720",
      line: "#2E2939",
      t1: "#EFEAF5",
      t2: "#A29BB0",
      t3: "#6A6478",
      acc: "#8A5CF0",
      onAcc: "#FFFFFF",
      playing: "#C9A6FF",
      hatchA: "#221E2A",
      hatchB: "#191622",
    },
    light: {
      bg: "#F7F5FB",
      surf: "#FFFFFF",
      line: "#E4DFEE",
      t1: "#1C1826",
      t2: "#665F78",
      t3: "#665F78",
      acc: "#7343DE",
      onAcc: "#FFFFFF",
      playing: "#5B2FBF",
      hatchA: "#EFEAF7",
      hatchB: "#E3DCEF",
    },
  },
  {
    id: "vinyl",
    name: "Late-Night Vinyl",
    tag: "warm brown-black, terracotta, ember gold",
    hues: "brown-black · terracotta · ember gold",
    dark: {
      bg: "#121110",
      surf: "#1B1815",
      line: "#2E2925",
      t1: "#F5EFE4",
      t2: "#A89F91",
      t3: "#6B6358",
      acc: "#D97B4F",
      onAcc: "#1B1815",
      playing: "#F2B705",
      hatchA: "#221E19",
      hatchB: "#191612",
    },
    light: {
      bg: "#FAF6EF",
      surf: "#FFFFFF",
      line: "#E5DDD0",
      t1: "#221E19",
      t2: "#6B6358",
      t3: "#6B6358",
      acc: "#D97B4F",
      onAcc: "#1B1815",
      playing: "#8A5A00",
      hatchA: "#EFE8DC",
      hatchB: "#E3DACB",
    },
  },
  {
    id: "oxblood",
    name: "Oxblood & Bone",
    tag: "warm, closest cousin to vinyl",
    hues: "wine-black · oxblood · dusty rose",
    dark: {
      bg: "#121011",
      surf: "#1B1618",
      line: "#2F2529",
      t1: "#F4EEE7",
      t2: "#A99A96",
      t3: "#6C5D5B",
      acc: "#B5384F",
      onAcc: "#FFF4F6",
      playing: "#E8A7B8",
      hatchA: "#231B1E",
      hatchB: "#1A1416",
    },
    light: {
      bg: "#FAF5F3",
      surf: "#FFFFFF",
      line: "#E8DBD8",
      t1: "#221A1C",
      t2: "#6C5D5B",
      t3: "#6C5D5B",
      acc: "#B5384F",
      onAcc: "#FFF4F6",
      playing: "#8E2C40",
      hatchA: "#F0E7E4",
      hatchB: "#E4D8D5",
    },
  },
  {
    id: "steel",
    name: "Blueprint Steel",
    tag: "cool departure — archival, technical",
    hues: "slate-black · signal blue · ice",
    dark: {
      bg: "#0F1216",
      surf: "#171B21",
      line: "#28303A",
      t1: "#E9EEF3",
      t2: "#94A0AD",
      t3: "#5D6874",
      acc: "#3E7BFA",
      onAcc: "#FFFFFF",
      playing: "#7FD1FF",
      hatchA: "#1E242B",
      hatchB: "#151A20",
    },
    light: {
      bg: "#F4F7FA",
      surf: "#FFFFFF",
      line: "#DBE3EC",
      t1: "#131A22",
      t2: "#5D6874",
      t3: "#5D6874",
      acc: "#2B5FC7",
      onAcc: "#FFFFFF",
      playing: "#14589E",
      hatchA: "#EDF2F7",
      hatchB: "#E1E8F0",
    },
  },
  {
    id: "forest",
    name: "Night Green",
    tag: "near-black + streaming green",
    hues: "black-green · signal green · mint",
    dark: {
      bg: "#0E1511",
      surf: "#0E1511",
      line: "#26362D",
      t1: "#EAF4EE",
      t2: "#9DB3A6",
      t3: "#63786C",
      acc: "#1ED760",
      onAcc: "#06130C",
      playing: "#1ED760",
      hatchA: "#1C2B23",
      hatchB: "#121C16",
    },
    light: {
      bg: "#F3F7F3",
      surf: "#F3F7F3",
      line: "#D8E6DB",
      t1: "#14231A",
      t2: "#4E6356",
      t3: "#4E6356",
      acc: "#148A3F",
      onAcc: "#FFFFFF",
      playing: "#0F7A38",
      hatchA: "#E7F1E9",
      hatchB: "#DBE9DE",
    },
  },
  {
    id: "afterglow",
    name: "Afterglow",
    tag: "late neon — magenta action, cyan play",
    hues: "void · hot magenta · ice cyan",
    dark: {
      bg: "#120E16",
      surf: "#1A1520",
      line: "#32283A",
      t1: "#F3EAF8",
      t2: "#B39AB8",
      t3: "#736078",
      acc: "#E23D8A",
      onAcc: "#FFFFFF",
      playing: "#5CE1E6",
      hatchA: "#241B2A",
      hatchB: "#17121C",
    },
    light: {
      bg: "#F8F3F7",
      surf: "#FFFFFF",
      line: "#E7D8E4",
      t1: "#22141F",
      t2: "#736078",
      t3: "#736078",
      acc: "#C21D6E",
      onAcc: "#FFFFFF",
      playing: "#0E7A80",
      hatchA: "#F1E4EE",
      hatchB: "#E6D5E2",
    },
  },
];

export function isPaletteId(value: unknown): value is PaletteId {
  return PALETTE_IDS.includes(value as PaletteId);
}
