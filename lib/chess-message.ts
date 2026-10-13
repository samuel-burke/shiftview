// Chess games travel as JSON message bodies. Parsing them lives apart from
// components/ChessBoard so the message thread can recognise a game without
// pulling the board (react-chessboard, chess.js) into every page's bundle;
// the board itself is loaded only when a game is shown.

export type ChessMessage = {
  fen: string;
  white: string;
  black: string;
  status: "active" | "white_wins" | "black_wins" | "draw";
  lastMoveFlags?: string; // chess.js move flags: c=capture, k/q=castle, e=en passant, p=promotion
};

export function parseChessMessage(body: string): ChessMessage | null {
  try {
    const parsed = JSON.parse(body);
    if (parsed._chess === true && parsed.fen && parsed.white && parsed.black && parsed.status)
      return parsed as ChessMessage;
  } catch {}
  return null;
}
