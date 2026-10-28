/**
 * SYSTEM DJ — Constantes de la interfaz
 * Valores compartidos por varios componentes; cambiarlos aquí los cambia en toda la aplicación.
 */

/**
 * Longitud máxima de los campos de texto libre (búsquedas, formularios, nombres). Los átomos de
 * entrada (TextField, Input) la aplican como `maxLength` por defecto; un campo solo la sustituye
 * por un límite de dominio más estricto (p. ej. el nombre de una playlist).
 */
export const INPUT_MAX_LENGTH = 100;

/** Las URL no son texto libre: un enlace largo (parámetros de YouTube) no debe recortarse. */
export const URL_INPUT_MAX_LENGTH = 2048;
