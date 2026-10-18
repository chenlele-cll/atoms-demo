import { useState, useEffect } from "react";
import { Button } from "./ui/button";
import { ArrowUpToLine } from "lucide-react";

export const ScrollToTop = () => {
  const [showTopBtn, setShowTopBtn] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      if (window.scrollY > 400) {
        setShowTopBtn(true);
      } else {
        setShowTopBtn(false);
      }
    };
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const goToTop = () => {
    window.scroll({
      top: 0,
      left: 0,
    });
  };

  return (
    <>
      {showTopBtn && (
        <Button
          aria-label="Scroll to top"
          onClick={goToTop}
          className="fixed bottom-4 right-4 opacity-90 shadow-md"
          size="icon"
        >
          <ArrowUpToLine className="h-4 w-4" />
        </Button>
      )}
    </>
  );
};
