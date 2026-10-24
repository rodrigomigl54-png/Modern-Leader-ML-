// Commands are the only way the presentation layer changes the game (GDD section 2). The player
// issues any number of them during a turn; the turn engine applies them when the turn resolves.
// Each system adds its own members to this union (InvestCommand in Phase 5, MoveArmyCommand in
// Phase 7, ...); until then no command exists.
export type Command = never;
