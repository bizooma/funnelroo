import MarketingHeader from "./MarketingHeader";
import MarketingFooter from "./MarketingFooter";

export default function MarketingLayout({ children }) {
  return (
    <div className="min-h-screen flex flex-col bg-white">
      <MarketingHeader />
      <main className="flex-1">{children}</main>
      <MarketingFooter />
    </div>
  );
}