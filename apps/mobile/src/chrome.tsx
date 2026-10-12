import { createContext, useContext } from "react";

/** Heights of the floating header and bottom bar that content scrolls beneath. */
export const ChromeContext = createContext({ top: 0, bottom: 0 });
export const useChrome = () => useContext(ChromeContext);
