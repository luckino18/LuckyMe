import { Buffer } from "@craftzdog/react-native-buffer";
import { install } from "react-native-quick-crypto";

install();

(globalThis as any).Buffer = Buffer;
