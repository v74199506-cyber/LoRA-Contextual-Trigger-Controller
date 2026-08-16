import { app } from "../../scripts/app.js";
import { LctcPanel } from "./lctc-panel.js";
import { discoverActiveLoras } from "./lctc-core.js";

const CSS = `
.lctc-launch{position:fixed;right:18px;bottom:70px;z-index:8999;display:flex;align-items:center;gap:8px;border:1px solid #555;background:#292931;color:#ddd;border-radius:999px;padding:9px 12px 9px 14px;font-weight:700;box-shadow:0 6px 24px #0007;transition:background .2s,border-color .2s,box-shadow .2s,transform .2s}
.lctc-launch[data-state=active]{background:#4f3baa;border-color:#806bea;color:#fff}.lctc-launch[data-state=review]{background:#5a421d;border-color:#d29a42;color:#fff}.lctc-launch[data-state=ready]{background:#255d48;border-color:#43b98a;color:#fff;box-shadow:0 6px 24px #0007,0 0 0 1px #43b98a55}
.lctc-launch-badge{display:inline-grid;place-items:center;min-width:22px;height:22px;padding:0 6px;border-radius:999px;background:#ffffff24;border:1px solid #ffffff38;font-size:11px}.lctc-launch[data-state=idle] .lctc-launch-badge{display:none}
.lctc-launch.lctc-pulse{animation:lctc-attention .65s ease-out 2}@keyframes lctc-attention{0%{transform:scale(1)}45%{transform:scale(1.07);box-shadow:0 0 0 7px #806bea35,0 6px 24px #0007}100%{transform:scale(1)}}
.lctc-panel{position:fixed;right:16px;top:124px;bottom:70px;width:min(420px,calc(100vw - 32px));z-index:9000;background:#17171c;color:#eee;border:1px solid #454550;border-radius:10px;box-shadow:0 12px 40px #000a;overflow-x:hidden;overflow-y:auto;font:13px system-ui,sans-serif}
.lctc-panel *{box-sizing:border-box}
.lctc-panel>header{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;align-items:center;padding:12px 14px;background:#202027;border-bottom:1px solid #3b3b44}.lctc-panel header div{display:flex;flex-direction:column}.lctc-panel small{color:#a9a9b5}.lctc-close{font-size:22px;background:none;border:0;color:#ccc}
.lctc-panel main,.lctc-panel>section{padding:12px 14px}.lctc-row,.lctc-actions{display:flex;column-gap:9px;row-gap:9px;flex-wrap:wrap}.lctc-row{align-items:center}.lctc-row select{flex:1;min-width:0}.lctc-picker{display:flex;flex-direction:column;gap:9px}.lctc-activity-summary{padding:8px 10px;border:1px solid #44444e;border-radius:6px;background:#222229;color:#bbb;font-size:12px;line-height:1.35}.lctc-activity-summary[data-state=ready]{border-color:#347b60;color:#85d3b5}.lctc-activity-summary[data-state=review]{border-color:#87652e;color:#e4b767}.lctc-actions{margin-top:12px}.lctc-panel button,.lctc-panel select,.lctc-panel input{background:#292931;color:#eee;border:1px solid #4a4a56;border-radius:5px;padding:7px 9px}.lctc-panel button{cursor:pointer;min-height:32px}.lctc-panel button.primary{background:#5842bd;border-color:#7662d7}.lctc-panel button.icon{margin-left:auto;padding:2px 7px;min-height:0}
.lctc-summary{display:flex;flex-direction:column;gap:3px;margin-bottom:14px;min-width:0}.lctc-summary strong,.lctc-summary span{overflow-wrap:anywhere}.lctc-summary span,.lctc-status{color:#aaa}.lctc-field{display:flex;flex-direction:column;gap:7px;margin-bottom:4px}.lctc-field select{width:100%;min-width:0}.lctc-type-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}.lctc-type-row .lctc-confirm-type{white-space:nowrap}.lctc-type-row .lctc-confirm-type:disabled{color:#85d3b5;border-color:#347b60;opacity:1;cursor:default}.lctc-group{border:1px solid #41414a;border-radius:7px;margin:14px 0;padding:11px}.lctc-group legend input{font-weight:700}.lctc-inline{display:block;margin-bottom:10px}.lctc-option{display:grid;gap:8px;align-items:center;padding:6px 0}.lctc-option-single{grid-template-columns:auto minmax(0,1fr) auto}.lctc-option-labeled{grid-template-columns:auto minmax(72px,.75fr) minmax(100px,1.25fr) auto}.lctc-option input:not([type=checkbox]):not([type=radio]){min-width:0;width:100%}.lctc-option-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;background:transparent!important;border-color:transparent!important;color:#cfc7f5!important;padding-left:2px!important;padding-right:2px!important}.lctc-option-label:hover{border-color:#59516f!important;background:#24222c!important}.lctc-option.lctc-automatic{grid-template-columns:auto 1fr;color:#aaa}.lctc-status{position:sticky;bottom:0;padding:11px 14px;background:#202027;border-top:1px solid #3b3b44;line-height:1.4}.lctc-status[data-error=true]{color:#ff9c9c}
@media (max-height:700px){.lctc-panel{top:102px;bottom:58px}.lctc-launch{bottom:58px}}
`;

app.registerExtension({
  name: "lctc.contextual-trigger-controller",
  async setup() {
    const style = document.createElement("style"); style.textContent = CSS; document.head.append(style);
    const button = document.createElement("button");
    button.className = "lctc-launch";
    button.dataset.state = "idle";
    const label = document.createElement("span"); label.textContent = "LoRA Triggers";
    const badge = document.createElement("span"); badge.className = "lctc-launch-badge"; badge.textContent = "0";
    button.append(label, badge);
    let lastActiveCount = 0;
    let lastSignature = "";
    let knownCounts = { ready: 0, review: 0 };
    const updateButton = (counts) => {
      const active = counts.active ?? 0;
      knownCounts = { ready: counts.ready ?? knownCounts.ready, review: counts.review ?? knownCounts.review };
      badge.textContent = String(active);
      button.dataset.state = !active ? "idle" : knownCounts.ready ? "ready" : knownCounts.review ? "review" : "active";
      button.title = !active ? "No active LoRAs detected." : `${active} active LoRA${active === 1 ? "" : "s"} detected. Open to review contextual triggers.`;
      if (active > lastActiveCount) {
        button.classList.remove("lctc-pulse");
        void button.offsetWidth;
        button.classList.add("lctc-pulse");
      }
      lastActiveCount = active;
    };
    const panel = new LctcPanel(app, updateButton);
    button.addEventListener("click", () => panel.toggle());
    document.body.append(button);
    const detectActivity = () => {
      const loras = discoverActiveLoras(app.graph);
      const signature = loras.map((lora) => `${lora.nodeId}:${lora.name}`).sort().join("|");
      if (signature !== lastSignature) {
        knownCounts = { ready: 0, review: 0 };
        lastSignature = signature;
      }
      updateButton({ active: loras.length });
    };
    detectActivity();
    window.setInterval(detectActivity, 1500);
  },
});
