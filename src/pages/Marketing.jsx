import MarketingLayout from "@/components/marketing/MarketingLayout";
import Hero from "@/components/marketing/Hero";
import Benefits from "@/components/marketing/Benefits";
import HowItWorks from "@/components/marketing/HowItWorks";
import Templates from "@/components/marketing/Templates";
import MeetRoo from "@/components/marketing/MeetRoo";
import ComingNext from "@/components/marketing/ComingNext";
import Faq from "@/components/marketing/Faq";
import FinalCta from "@/components/marketing/FinalCta";

export default function Marketing() {
  return (
    <MarketingLayout>
      <Hero />
      <Benefits />
      <HowItWorks />
      <Templates />
      <MeetRoo />
      <ComingNext />
      <Faq />
      <FinalCta />
    </MarketingLayout>
  );
}