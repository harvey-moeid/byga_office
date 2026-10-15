import { createContext, useContext, type ReactNode } from "react";
import { useData } from "./data";
import { roles } from "./shared";

const CharacterNames = createContext({ names: roles, refresh: () => {} });
export function CharacterNamesProvider({ children }: { children: ReactNode }) {
  const data = useData<{ id: string; display_name?: string }[]>(
    "/characters",
    30000,
  );
  const names = { ...roles };
  for (const character of data.data ?? []) {
    if (character.display_name) names[character.id] = character.display_name;
  }
  return (
    <CharacterNames.Provider value={{ names, refresh: data.retry }}>
      {children}
    </CharacterNames.Provider>
  );
}
export function useCharacterNames() {
  return useContext(CharacterNames);
}
export function useCharacterLabels() {
  return useCharacterNames().names;
}
