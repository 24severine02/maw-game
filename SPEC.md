Maw — Game Spec
Online multiplayer browser card game with in-game voice chat. Built with the help of Claude Code.
1. Setup
        Players: 2–8, online only, joined via room invite link.
        Decks: 1 standard 52-card deck for 2 players, 2 decks (104 cards) for 3+ players. Deck count is
        shown in the lobby before the game starts.
        Each player is dealt 7 cards. Next card is turned face up to start the discard pile; the rest is the
        draw pile.
        Starting card: if special, its effect applies immediately to the first player (see §4).
2. Turn
    1. Play one card that matches the top card's suit or rank (Jack can be played on anything, see §3).
    2. If no playable card: draw 1. If it's playable, may play it immediately. Otherwise pass.
    3. Draw pile empty → shuffle discard pile (except top card) into new draw pile.
3. Special cards
   
Card                     Effect

Queen                    Reverse direction

9                        Play again

8                        Skip next player

7                        Next player draws 2 (stackable)

Jack                     Transparent / wild (see below)


Stacking 7s: A player facing a pending draw may play a 7 or a Jack (acting as 7) to add +2 and pass
the total on. Otherwise they draw the full total, then continue their turn normally: they may play a 7,
a Jack, or a card of the current suit, or follow §2 if they can't.
Jack:
        Can be played on any card.
        On a special card: copies that card's effect and rank, with the Jack's suit. E.g. J♠ on 7♥ = 7♠ (next
        player draws 2; can answer with a 7, a Jack, or after drawing, a ♠).
        On a non-special card: player chooses the new suit.
        A Jack can always be played on a Jack.
Final (2 players): Queen, 9 and 8 all mean the player plays again.
4. Maw / Mamaw
       Maw: when a player goes down to 1 card, they must press Maw.
       Mamaw: when playing their last card, they must press Mamaw.
       Call-out: if a player forgets, any other player can press Call out. Penalty: the forgetter draws 2.
       No win on a 9: if the last card is a 9 (or a Jack acting as 9), the player must play again: draw 1,
       press Maw (1 card in hand), then play it with Mamaw if playable, or pass and keep it.
       A player can win with a 7, 8, Queen or Jack.
5. Round end & scoring
       Round ends when a player empties their hand (with Mamaw). That player wins the round.
       Other players count the cards in their hand:

Card                                                      Points

2–6                                                       Face value

10, King, Ace                                             10

7                                                         14

8                                                         16

9                                                         18

Queen                                                     20

Jack                                                      20


       Points count per round only (no running total).
       Player with the most points is eliminated. A tie eliminates all tied players.
       Eliminated players stay as spectators (can watch and stay on voice, cannot play).
       New round: deal 7 cards to the remaining players. Deck count is re-evaluated (2 decks if 3+
       players remain, 1 deck for the final).
       When 2 players remain, that round is the final. Its winner wins the game.
       If eliminations leave only the round winner, they win the game.
 3. Starting 9: no effect (nobody played it). Starting Jack: first player chooses the suit.
 4. Jack on a Jack-acting-as-7: still counts as a 7 (stacks).
7. Tech
    Frontend: Next.js / React.
    Game server: Node.js + Socket.io. Server is authoritative: holds deck and hands,
    validates moves, sends each client only its own hand.
    Rooms: create room → share link → lobby (nickname, mic check, deck count shown) → host
    starts.
    Hosting: Docker on Azure.
    Reconnect: a player who drops can rejoin the same seat within a timeout.

