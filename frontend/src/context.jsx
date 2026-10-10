import { createContext, useContext } from 'react'

export const AppContext = createContext({ stages: [], config: null, me: null, users: [], switchUser() {}, signOut() {}, refreshMe() {} })

export const useApp = () => useContext(AppContext)
export const useStages = () => useApp().stages
export const useConfig = () => useApp().config
export const useMe = () => useApp().me
export const useUsers = () => useApp().users

/** Does the signed-in user hold this permission? (The server enforces it too.) */
export function useCan() {
  const me = useMe()
  return (perm) => !!me && (me.permissions.includes('*') || me.permissions.includes(perm))
}

export const stageOf = (stages, key) => stages.find((s) => s.key === key)

/** Project pages use the workflow version the project started on, not the one currently published. */
export function FlowScope({ stages, children }) {
  const app = useApp()
  return <AppContext.Provider value={{ ...app, stages }}>{children}</AppContext.Provider>
}
