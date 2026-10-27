import type { CompactApi, DesktopApi } from "../shared";
declare global { interface Window { callme: DesktopApi; callmeCompact: CompactApi } }
