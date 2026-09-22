// Lucideアイコン(https://lucide.dev/)をインラインSVGとして埋め込むためのヘルパー。
// lucide-staticの各SVGはstroke="currentColor"のため、CSSのcolorプロパティで
// 色を制御できる(width/height属性は外し、CSS側でサイズ指定する)。
import bookOpen from "lucide-static/icons/book-open.svg?raw";
import volume2 from "lucide-static/icons/volume-2.svg?raw";
import volumeX from "lucide-static/icons/volume-x.svg?raw";
import play from "lucide-static/icons/play.svg?raw";
import pause from "lucide-static/icons/pause.svg?raw";
import rotateCcw from "lucide-static/icons/rotate-ccw.svg?raw";
import house from "lucide-static/icons/house.svg?raw";
import share2 from "lucide-static/icons/share-2.svg?raw";
import x from "lucide-static/icons/x.svg?raw";
import trash2 from "lucide-static/icons/trash-2.svg?raw";
import copyright from "lucide-static/icons/copyright.svg?raw";

const ICONS = {
  "book-open": bookOpen,
  "volume-2": volume2,
  "volume-x": volumeX,
  play,
  pause,
  "rotate-ccw": rotateCcw,
  house,
  "share-2": share2,
  x,
  "trash-2": trash2,
  copyright,
} as const;

export type IconName = keyof typeof ICONS;

export function createIcon(name: IconName): SVGSVGElement {
  const template = document.createElement("template");
  template.innerHTML = ICONS[name].trim();
  const svg = template.content.firstElementChild as SVGSVGElement;
  svg.classList.add("icon");
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  return svg;
}
