// Quackify Dev (npm run app:dev, identifier dev.enderex.quackify.dev) puts "dev" on <html>, and
// tokens.css swaps the gold accent for the green of its icon, like Quack Dev does.
import { getIdentifier } from "@tauri-apps/api/app";

getIdentifier()
  .then((id) => document.documentElement.classList.toggle("dev", id.endsWith(".dev")))
  .catch(() => {});
