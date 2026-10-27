import logo from "../../assets/lazycall-logo-monochrome.png";
import wordmark from "../../assets/lazycall-wordmark.svg";

export function BrandMark() {
  return <span className="brand-symbol" aria-hidden="true" style={{ maskImage: `url(${logo})` }} />;
}

export function BrandWordmark() {
  return <span className="brand-wordmark" aria-hidden="true" style={{ maskImage: `url(${wordmark})` }} />;
}
