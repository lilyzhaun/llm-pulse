import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const DESKTOP_HEARTBEAT_SLOT_COUNT = 60;
const MOBILE_HEARTBEAT_SLOT_COUNT = 30;
const MOBILE_HEARTBEAT_QUERY = "(max-width: 720px)";

type HeartbeatSlotContextValue = number;

const HeartbeatSlotContext = createContext<HeartbeatSlotContextValue>(
  DESKTOP_HEARTBEAT_SLOT_COUNT,
);

function getHeartbeatSlotCount() {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return DESKTOP_HEARTBEAT_SLOT_COUNT;
  }

  return window.matchMedia(MOBILE_HEARTBEAT_QUERY).matches
    ? MOBILE_HEARTBEAT_SLOT_COUNT
    : DESKTOP_HEARTBEAT_SLOT_COUNT;
}

export function HeartbeatSlotProvider({ children }: { children: ReactNode }) {
  const [slotCount, setSlotCount] = useState(getHeartbeatSlotCount);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }

    const mediaQuery = window.matchMedia(MOBILE_HEARTBEAT_QUERY);
    const updateSlotCount = () => {
      setSlotCount(
        mediaQuery.matches
          ? MOBILE_HEARTBEAT_SLOT_COUNT
          : DESKTOP_HEARTBEAT_SLOT_COUNT,
      );
    };

    updateSlotCount();
    mediaQuery.addEventListener("change", updateSlotCount);

    return () => {
      mediaQuery.removeEventListener("change", updateSlotCount);
    };
  }, []);

  const value = useMemo(() => slotCount, [slotCount]);

  return (
    <HeartbeatSlotContext.Provider value={value}>
      {children}
    </HeartbeatSlotContext.Provider>
  );
}

export function useHeartbeatSlotCount() {
  return useContext(HeartbeatSlotContext);
}
