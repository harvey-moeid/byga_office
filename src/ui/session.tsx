import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { authExpiredEvent, useData } from "./data";

type Session = ReturnType<typeof useData<{ admin: boolean }>> & {
  invalidate: () => void;
};
const SessionContext = createContext<Session | null>(null);
export function SessionProvider({ children }: { children: ReactNode }) {
  const session = useData<{ admin: boolean }>("/auth/session", 30000);
  const [expired, setExpired] = useState(false);
  const wasAdmin = useRef(false);
  useEffect(() => {
    if (wasAdmin.current && session.data?.admin === false) {
      setExpired(true);
      window.dispatchEvent(new Event(authExpiredEvent));
    }
    wasAdmin.current = session.data?.admin === true;
  }, [session.data?.admin]);
  useEffect(() => {
    const expire = () => {
      if (session.data?.admin) {
        setExpired(true);
        session.retry();
      }
    };
    window.addEventListener(authExpiredEvent, expire);
    return () => window.removeEventListener(authExpiredEvent, expire);
  }, [session.data?.admin, session.retry]);
  const value = {
    ...session,
    data: expired ? { admin: false } : session.data,
    retry: () => {
      setExpired(false);
      session.retry();
    },
    invalidate: () => {
      setExpired(true);
      window.dispatchEvent(new Event(authExpiredEvent));
      session.retry();
    },
  };
  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}
export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("SessionProvider is required");
  return session;
}
