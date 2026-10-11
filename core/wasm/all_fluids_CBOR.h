/* Shadows CoolProp's generated all_fluids_CBOR.h in the WebAssembly build.
 * The embedded fluid library is an empty CBOR array; fluids are fetched on demand by the web app
 * (web/public/fluids/<name>.json, written by tools/split_fluids.py) and registered at runtime with
 * CoolProp::add_fluids_as_JSON. This keeps ~4.6 MB of superancillary data out of the initial download. */
#ifdef __cplusplus
extern "C" {
#endif
INCBIN_CONST INCBIN_ALIGN unsigned char gall_fluids_CBORData[] = {0x80};
INCBIN_CONST INCBIN_ALIGN unsigned char* const gall_fluids_CBOREnd = gall_fluids_CBORData + sizeof(gall_fluids_CBORData);
INCBIN_CONST unsigned int gall_fluids_CBORSize = sizeof(gall_fluids_CBORData);
#ifdef __cplusplus
}
#endif
