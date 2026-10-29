import { LibreDwg, Dwg_File_Type } from "@mlightcad/libredwg-web";
self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  let pointer: number | undefined;
  try {
    const library = await LibreDwg.create();
    pointer = library.dwg_read_data(event.data, Dwg_File_Type.DWG);
    if (!pointer) throw Error("Unsupported DWG");
    const model = library.convert(pointer),
      svg = library.dwg_to_svg(model);
    if (!svg || !svg.includes("<svg")) throw Error("Empty drawing");
    self.postMessage({ svg });
    library.dwg_free(pointer);
  } catch {
    self.postMessage({ error: true });
  }
};
