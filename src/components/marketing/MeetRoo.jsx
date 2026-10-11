import { useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { Reveal } from "./Reveal";

const ROO_VIDEO_URL = "https://media.base44.com/videos/public/6acba9de240facdd95f5665d/76dcc26fe_gemini_generated_video_0a0cda66.mp4";

export default function MeetRoo() {
  const videoRef = useRef(null);
  const [muted, setMuted] = useState(true);

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };

  return (
    <section className="py-20 md:py-28 bg-indigo-50/40">
      <div className="mx-auto max-w-6xl px-5 grid md:grid-cols-2 gap-12 items-center">
        <Reveal>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900">
            Meet Roo. Your sales funnel sidekick.
          </h2>
          <p className="mt-5 text-lg text-slate-600 leading-relaxed">
            Roo helps you shape your message, organize your funnel, and work through the next step. You bring the business knowledge. Roo helps you turn it into something you can edit, review, and publish.
          </p>
          <p className="mt-4 text-base text-slate-500 italic">
            You stay in control of the message and the final result.
          </p>
        </Reveal>
        <Reveal delay={0.15} className="flex justify-center">
          <div className="relative max-w-sm w-full">
            <div className="overflow-hidden rounded-2xl border border-slate-200 shadow-xl bg-white">
              <video
                ref={videoRef}
                src={ROO_VIDEO_URL}
                className="w-full h-auto block"
                autoPlay
                muted
                loop
                playsInline
                controls={false}
              />
              <button
                type="button"
                onClick={toggleMute}
                aria-label={muted ? "Unmute video" : "Mute video"}
                className="absolute top-3 right-3 inline-flex items-center justify-center h-9 w-9 rounded-full bg-black/55 text-white backdrop-blur-sm hover:bg-black/70 transition-colors"
              >
                {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
            </div>
            <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-white rounded-full border border-slate-200 shadow-md px-4 py-1.5 text-sm font-medium text-slate-700 whitespace-nowrap">
              Hi, I'm Roo 👋
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}