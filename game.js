const API_URL = "https://script.google.com/macros/s/AKfycbz6vCg6M83zEaMLKjc-SeRzLtHbrGXfwcugtP5pnM5QgYb5U_9GBv1rBM81oB5HKO0M_Q/exec";
const categories1 = ["Domme", "Influencer/Brat", "Adult Star", "Celebrity", "Captions"];
const categories2 = ["Blonde", "Red", "Brunette"];

let lastRoundScore = 0;
let activeBonusValue = 0; 
let isRolling = false;
let userRole = "hero"; 

// NEW: two independent dice ticket trackers (hero's and villainess's), kept
// in memory so rollSharedArenaDice can guard against double-rolls that slip
// through in the ~2s gap between polls. Each role can only play one card per
// round, so at most one ticket per role is ever active — no more than this
// is needed even when both BLOCK_D6 and ATTACK_D6 are in play at once.
let currentHeroTicket = null;
let currentVillainessTicket = null;

// UX: last confirmed server state, so we can force a re-render (e.g. to show
// a pending indicator) without needing a fresh network response.
let lastKnownData = null;

// UX: the card ID currently awaiting server confirmation, so we can show a
// "Deploying..." state on just that card instead of guessing at outcomes.
let pendingCardId = null;

// GENERIC DICE-EFFECT HELPER (mirrors the server-side version in appscript.txt):
// any effectType matching ACTION_D<number> is recognized as needing a dice
// roll, with side-count parsed from the name — no hardcoded effect-type list.
function parseDiceEffect(effectType) {
    let match = /^([A-Z]+)_D(\d+)$/.exec(String(effectType || ""));
    if (!match) return null;
    return { actionPrefix: match[1], diceSides: parseInt(match[2]) };
}

function checkPlayerRole() {
    const urlParams = new URLSearchParams(window.location.search);
    const roleParam = urlParams.get('role');
    if (roleParam === 'villainess') {
        userRole = "villainess";
        const indicator = document.getElementById('roleIndicator');
        indicator.innerText = "Role: Villainess (Player 2)";
        indicator.className = "role-banner villain-role";
        document.querySelectorAll('.hero-control').forEach(el => el.style.display = 'none');
    } else {
        userRole = "hero";
        document.getElementById('roleIndicator').innerText = "Role: Hero (Player 1)";
        const villainSetupBox = document.getElementById('villainSetup');
        if (villainSetupBox) villainSetupBox.style.display = 'none';
    }
}

function updateUI(data) {
    // UX: remember the last real state so we can force a re-render (e.g. to
    // show/clear a pending card indicator) without a fresh network call.
    lastKnownData = data;

    const remHp = parseInt(data.remainingHp);
    const startHp = parseInt(data.startingHp);
    const maxRounds = parseInt(data.maxRounds) || 15; 
    const currentCurse = parseInt(data.curseAmount) || 0;

    document.getElementById('startHp').innerText = startHp;
    document.getElementById('remHp').innerText = remHp;
    document.getElementById('spin1Val').innerText = data.spinner1 || "None";
    document.getElementById('spin2Val').innerText = data.spinner2 || "None";
    document.getElementById('curseValue').innerText = currentCurse;

    if (userRole === "villainess") {
        const setupBox = document.getElementById('villainSetup');
        if (setupBox) {
            if (currentCurse > 0) setupBox.style.display = 'none';
            else setupBox.style.display = 'inline-flex';
        }
    }

    document.getElementById('heroWinCount').innerText = data.heroWins || 0;
    document.getElementById('villainWinCount').innerText = data.villainessWins || 0;
    
    const streakCard = document.getElementById('streakCard');
    const streakDisplay = document.getElementById('streakDisplay');
    const streakWinner = data.currentStreakWinner || "None";
    const streakCount = data.currentStreakCount || 0;

    if (streakWinner === "Villainess" && streakCount > 0) {
        streakDisplay.innerText = `Villainess 🔥 ${streakCount} Wins (+${streakCount * 5} HP Catchup)`;
        if (streakCard) streakCard.style.borderColor = "#ff4757";
    } else if (streakWinner === "Hero" && streakCount > 0) {
        streakDisplay.innerText = `Hero 🌟 ${streakCount} Wins`;
        if (streakCard) streakCard.style.borderColor = "#1e90ff";
    } else {
        streakDisplay.innerText = "No Active Streak";
        if (streakCard) streakCard.style.borderColor = "#444";
    }

    // NEW: parse BOTH shared dice tickets — hero's (BLOCK_D6/HEAL_D10) and
    // villainess's (ATTACK_D6) — since both can be active in the same round
    // now that each role gets its own cell instead of sharing one.
    // Format for each: cardId|effectType|rollValue|rollerRole
    function parseArenaTicket(str) {
        if (!str) return null;
        let parts = str.split("|");
        return { cardId: parts[0], effectType: parts[1], rollValue: parseInt(parts[2]) || 0, rollerRole: parts[3] };
    }
    let heroTicket = parseArenaTicket(data.heroDiceState);
    let villainessTicket = parseArenaTicket(data.villainessDiceState);
    // Keep the in-memory guards in sync with the latest server state every
    // time we poll, so rollSharedArenaDice can check against real state
    // instead of relying on DOM/CSS timing alone.
    currentHeroTicket = heroTicket;
    currentVillainessTicket = villainessTicket;

    // Check if the current round has been Silenced by V_TRIG card
    let isSilenced = data.activeFieldCards ? data.activeFieldCards.some(c => c.id === "V_TRIG") : false;

    // ==========================================
    // VISUAL RENDER BLOCK: THE ACTIVE COMBAT FIELD (WITH INTERACTIVE ROLLS)
    // ==========================================
    let fieldHtml = "";
    if (data.activeFieldCards && data.activeFieldCards.length > 0) {
        data.activeFieldCards.forEach(card => {
            let roleClass = card.role === "hero" ? "card-hero" : "card-villainess";
            let diceElementHtml = "";

            // A card's roll ticket is whichever one (hero's or villainess's)
            // has a matching cardId — both can be present at once now, since
            // each role can have its own card+ticket active simultaneously.
            let matchingTicket = null;
            if (heroTicket && heroTicket.cardId === card.id) matchingTicket = heroTicket;
            else if (villainessTicket && villainessTicket.cardId === card.id) matchingTicket = villainessTicket;

            // GENERIC FIX: any effectType matching ACTION_D<number> gets a
            // dice widget — no more hardcoded BLOCK_D6/ATTACK_D6/HEAL_D10
            // list. Side-count is parsed straight from the name.
            let diceEffect = matchingTicket ? parseDiceEffect(matchingTicket.effectType) : null;
            if (matchingTicket && diceEffect) {
                let maxSides = diceEffect.diceSides;
                let displayVal = matchingTicket.rollValue > 0 ? matchingTicket.rollValue : `d${maxSides}`;
                let isMyTurnToRoll = (userRole === matchingTicket.rollerRole) && (matchingTicket.rollValue === 0) && !isRolling;
                
                let disabledClass = isMyTurnToRoll ? "" : " disabled";
                let dynamicPrompt = matchingTicket.rollValue > 0 ? "ROLL CAST" : (userRole === matchingTicket.rollerRole ? "YOUR TURN TO ROLL" : "WAITING FOR OPPONENT");

                // Unique per-card element id: two dice widgets can now render
                // at once (one for the hero's card, one for the villainess's)
                diceElementHtml = `
                    <div class="arena-dice-wrapper">
                        <div class="arena-dice-prompt">${dynamicPrompt}</div>
                        <div id="arenaDice_${card.id}" class="arena-dice${disabledClass}" onclick="rollSharedArenaDice('${card.id}', '${matchingTicket.effectType}', ${maxSides}, '${matchingTicket.rollerRole}')">
                            ${displayVal}
                        </div>
                    </div>
                `;
            }

            fieldHtml += `
                <div class="game-card ${roleClass}">
                    <div class="card-header-title">${card.name}</div>
                    <div class="card-body-desc">${card.desc}</div>
                    ${diceElementHtml}
                </div>
            `;
        });
    } else {
        fieldHtml = `<div class="field-placeholder">No cards activated yet for this round...</div>`;
    }
    const combatZoneEl = document.getElementById('activeCombatZone');
    if (combatZoneEl) combatZoneEl.innerHTML = fieldHtml;

    // ==========================================
    // VISUAL RENDER BLOCK: PLAYER PRIVATE HAND (UPDATED FOR ANTI-STACKING)
    // ==========================================
    let handHtml = "";
    let currentHand = userRole === "hero" ? data.heroCards : data.villainessCards;
    
    // 1. Check if the current round has been Silenced by V_TRIG card
    isSilenced = data.activeFieldCards ? data.activeFieldCards.some(c => c.id === "V_TRIG") : false;

    // 2. ANTI-STACKING CHECK: Scan the active combat field cards
    // If ANY card in the arena belongs to the local player's role, we lock their whole hand!
    let roleHasPlayedThisRound = false;
    if (data.activeFieldCards) {
        roleHasPlayedThisRound = data.activeFieldCards.some(card => {
            let cardRole = card.id.indexOf("H_") === 0 ? "hero" : "villainess";
            return cardRole === userRole;
        });
    }

    if (currentHand && currentHand.length > 0) {
        currentHand.forEach(card => {
            let roleClass = card.role === "hero" || userRole === "hero" ? "card-hero" : "card-villainess";

            // UX: is this the exact card currently awaiting server confirmation?
            let isPending = (card.id === pendingCardId);
            
            // A card is disabled if it's spent, locked by round, if the hero is silenced, if the player already played a card this round, OR if it's mid-flight!
            let isDisabled = card.spent || card.lockedByRound || (userRole === "hero" && isSilenced) || roleHasPlayedThisRound || isPending;
            let cardClass = `game-card ${roleClass}` + (isDisabled ? " disabled" : "") + (isPending ? " card-pending" : "");
            
            let stampLabel = "";
            if (isPending) stampLabel = `<div class="card-stamp-locked pending-stamp">⏳ DEPLOYING...</div>`;
            else if (card.spent) stampLabel = `<div class="card-stamp-locked">SPENT</div>`;
            else if (card.lockedByRound) stampLabel = `<div class="card-stamp-locked">LOCKED (RND)</div>`;
            else if (userRole === "hero" && isSilenced) stampLabel = `<div class="card-stamp-locked">SILENCED</div>`;
            else if (roleHasPlayedThisRound && !card.spent) stampLabel = `<div class="card-stamp-locked">1 CARD MAX</div>`; // Dynamic feedback text

            handHtml += `
                <div class="${cardClass}">
                    ${stampLabel}
                    <div class="card-header-title">${card.name}</div>
                    <div class="card-body-desc">${card.desc}</div>
                    <button class="btn-play-card" ${isDisabled ? 'disabled' : ''} 
                        onclick="activateCard('${card.id}', '${card.effectType}', ${card.value || 0}, '${card.name.replace(/'/g, "\\'")}', '${card.desc.replace(/'/g, "\\'")}')">
                        Activate Power
                    </button>
                </div>
            `;
        });
    } else {
        handHtml = `<div class="field-placeholder">No cards assigned. Reset game to draw hands.</div>`;
    }
    const handGridEl = document.getElementById('playerHandGrid');
    if (handGridEl) handGridEl.innerHTML = handHtml;

    // ==========================================
    // MATCH PROGRESS CELLS RENDER LOOP
    // ==========================================
    let gridHtml = "";
    let finalRawBaseScore = 0;
    let nextEmptyFound = false;
    let filledCount = 0;

    for (let i = 0; i < maxRounds; i++) {
        let dmg = data.scores[i];
        let baseDmg = data.baseScores ? data.baseScores[i] : 0;
        let bonusDmg = data.bonusScores ? data.bonusScores[i] : 0;
        let blockDmg = data.blockScores ? data.blockScores[i] : 0;
        let cellClass = "round-cell";
        let displayDmg = "-";
        let breakdownHtml = "";

        if (dmg !== undefined && dmg !== "" && dmg !== null) {
            let parsedDmg = parseInt(dmg);
            if (!isNaN(parsedDmg) && parsedDmg >= 0 && data.scores[i] !== "") {
                cellClass += " filled";
                displayDmg = parsedDmg;
                finalRawBaseScore = parseInt(baseDmg) || 0;
                filledCount++;

                // NEW: show the components that make up the final number —
                // Base + Bonus - Block = Final — so the math is visible at a
                // glance instead of just the total.
                let parsedBase = parseInt(baseDmg) || 0;
                let parsedBonus = parseInt(bonusDmg) || 0;
                let parsedBlock = parseInt(blockDmg) || 0;
                breakdownHtml = `
                    <div class="round-breakdown">
                        <span class="breakdown-item breakdown-base" title="Base damage">⚔️${parsedBase}</span>
                        <span class="breakdown-item breakdown-bonus" title="Bonus damage (10! bonus + Attack roll)">✨${parsedBonus}</span>
                        <span class="breakdown-item breakdown-block" title="Blocked">🛡️${parsedBlock}</span>
                    </div>
                `;
            } else if (!nextEmptyFound) {
                cellClass += " active"; nextEmptyFound = true;
            }
        } else if (!nextEmptyFound) {
            cellClass += " active"; nextEmptyFound = true;
        }
        gridHtml += `<div class="${cellClass}"><div class="round-num">Rnd ${i + 1}</div><div class="round-dmg">${displayDmg}</div>${breakdownHtml}</div>`;
    }
    document.getElementById('roundGrid').innerHTML = gridHtml;

    // UX: show the "10! Bonus" die to BOTH roles now (previously hero-only),
    // and disable clicking once it's been rolled so it can't be re-rolled.
    const serverBonusRoll = parseInt(data.bonusRoll) || 0;
    const bonusDiceEl = document.getElementById('diceElement');
    if (finalRawBaseScore === 10) {
        document.getElementById('bonusBox').style.display = 'flex';
        if (serverBonusRoll > 0) {
            activeBonusValue = serverBonusRoll;
            bonusDiceEl.innerText = serverBonusRoll;
            bonusDiceEl.classList.add('locked');
        } else {
            activeBonusValue = 0;
            bonusDiceEl.innerText = "?";
            bonusDiceEl.classList.remove('locked');
        }
        // Only the hero can actually roll it; villainess gets a read-only view
        const canRollNow = (userRole === "hero" && serverBonusRoll === 0);
        bonusDiceEl.style.pointerEvents = canRollNow ? "auto" : "none";
        bonusDiceEl.style.cursor = canRollNow ? "pointer" : "default";
    } else {
        document.getElementById('bonusBox').style.display = 'none';
        bonusDiceEl.innerText = "?";
        bonusDiceEl.classList.remove('locked');
        activeBonusValue = 0;
    }

    // NEW: block score submission while a BLOCK_D6/ATTACK_D6 card is in play
    // but hasn't been rolled yet — the final score depends on that roll, so
    // submitting early would lock in an incomplete total.
    const rollIsPending = isDiceRollPending(data);
    const submitBtn = document.getElementById('submitScoreBtn');
    const scoreInputEl = document.getElementById('scoreInput');
    if (submitBtn && scoreInputEl) {
        submitBtn.disabled = rollIsPending;
        scoreInputEl.disabled = rollIsPending;
        submitBtn.innerText = rollIsPending ? "Waiting for dice roll..." : "Submit Attack";
    }

    const overlay = document.getElementById('gameOverOverlay');
    const goBox = document.getElementById('gameOverBox');
    const goTitle = document.getElementById('gameOverTitle');
    const goMsg = document.getElementById('gameOverMsg');

    if (remHp <= 0) {
        overlay.style.display = 'flex';
        if (userRole === "hero") {
            goBox.className = "game-over-box loss-theme"; goTitle.innerText = "Defeat!"; goMsg.innerText = "Your HP fell to 0. The Villainess wins the match!";
        } else {
            goBox.className = "game-over-box win-theme"; goTitle.innerText = "Victory!"; goMsg.innerText = "The Hero's HP has been completely reduced to 0. You break his resolve and win!";
        }
    } 
    else if (filledCount >= maxRounds && remHp > 0) {
        overlay.style.display = 'flex';
        if (userRole === "hero") {
            goBox.className = "game-over-box win-theme"; goTitle.innerText = "Victory!"; goMsg.innerText = `You successfully endured all ${maxRounds} rounds with ${remHp} HP remaining. You win!`;
        } else {
            goBox.className = "game-over-box loss-theme"; goTitle.innerText = "Defeat!"; goMsg.innerText = `The Hero successfully survived all ${maxRounds} rounds of attacks. You lose.`;
        }
    } else { overlay.style.display = 'none'; }

    let tableHtml = "";
    if (data.rawHistory && data.rawHistory.length > 0) {
        data.rawHistory.forEach(item => {
            let winClass = item.winner === "Hero" ? "history-winner-hero" : "history-winner-villain";
            let displayDate = String(item.date).split('T') || item.date;
            tableHtml += `<tr><td>${displayDate}</td><td class="${winClass}">${item.winner}</td><td>${item.cat1}</td><td>${item.cat2}</td><td>${item.startHp}</td><td>${item.finalHp}</td><td>${item.rounds}</td><td>+${item.curse}</td></tr>`;
        });
    } else {
        tableHtml = `<tr><td colspan="8" style="text-align:center; color:#999;">No logged matches found.</td></tr>`;
    }
    document.getElementById('historyTableBody').innerHTML = tableHtml;
}

// GENERIC FIX: true if ANY dice ticket (hero's or villainess's) exists but
// hasn't been rolled yet — not just BLOCK_D6/ATTACK_D6 by name. A ticket only
// ever gets created for effects that matched ACTION_D<number> in the first
// place, so its mere existence with rollValue still 0 is enough to know a
// roll is outstanding, regardless of what that card's effect actually does.
// Shared by updateUI (to gate the submit button) and submitScore (hard guard).
function isDiceRollPending(data) {
    function parseTicket(str) {
        if (!str) return null;
        let parts = str.split("|");
        return { rollValue: parseInt(parts[2]) || 0 };
    }
    let h = parseTicket(data.heroDiceState);
    let v = parseTicket(data.villainessDiceState);
    return (h && h.rollValue === 0) || (v && v.rollValue === 0);
}

// Interactive Shared Arena Multi-Player Rolling Controller Machine
function rollSharedArenaDice(cardId, effectType, maxSides, rollerRole) {
    if (isRolling || userRole !== rollerRole) return;
    // BUG FIX #3: guard against double-rolling a ticket that was already
    // resolved by the other player in the ~2s gap before our next poll
    // refreshes the DOM/CSS disabled state. Check whichever ticket belongs
    // to this roller (hero's or villainess's — both can be active at once).
    let relevantTicket = (rollerRole === "villainess") ? currentVillainessTicket : currentHeroTicket;
    if (!relevantTicket || relevantTicket.cardId !== cardId || relevantTicket.rollValue > 0) return;

    isRolling = true;

    const diceEl = document.getElementById('arenaDice_' + cardId);
    if (diceEl) diceEl.classList.add('rolling');

    let intervals = setInterval(() => {
        if (diceEl) diceEl.innerText = Math.floor(Math.random() * maxSides) + 1;
    }, 60);

    setTimeout(async () => {
        clearInterval(intervals);
        if (diceEl) diceEl.classList.remove('rolling');

        let finalRoll = Math.floor(Math.random() * maxSides) + 1;
        if (diceEl) diceEl.innerText = finalRoll;
        isRolling = false;

        // Bundle updated state string to lock roll values in the sheet
        let updatedArenaString = `${cardId}|${effectType}|${finalRoll}|${rollerRole}`;

        try {
            // 1. Post final selection result to database
            let response = await fetch(API_URL, {
                method: "POST",
                body: JSON.stringify({ action: "submitLiveDiceArenaRoll", updatedArenaString: updatedArenaString })
            });

            // GENERIC FIX: route to the healing accumulator based on the
            // action prefix ("HEAL") rather than the exact string "HEAL_D10",
            // so a future HEAL_D8 or similar would work without a code change.
            let effect = parseDiceEffect(effectType);
            if (effect && effect.actionPrefix === "HEAL") {
                await fetch(API_URL, {
                    method: "POST",
                    body: JSON.stringify({ action: "applyHealCard", rollValue: finalRoll })
                });
            }

            let data = await response.json();
            updateUI(data);
        } catch (err) {
            console.error("Error finalizing network dice parameters:", err);
        }
    }, 600);
}

// BUG FIX #4: "10! Bonus" die is now server-authoritative. The client just
// asks the server to roll and store the value (B13); it no longer invents
// the number itself, so a modified client can't inflate its own bonus.
async function rollBonusDice() {
    if (isRolling) return;
    // NEW: only the hero rolls this die (villainess now sees it, read-only),
    // and it can't be rolled again once a value is already recorded.
    if (userRole !== "hero") return;
    if (lastKnownData && parseInt(lastKnownData.bonusRoll) > 0) return;

    isRolling = true;
    const dice = document.getElementById('diceElement');
    dice.classList.add('rolling');
    let intervals = setInterval(() => { dice.innerText = Math.floor(Math.random() * 6) + 1; }, 60);

    setTimeout(async () => {
        clearInterval(intervals);
        dice.classList.remove('rolling');
        try {
            let response = await fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "rollBonusDice" }) });
            let data = await response.json();
            activeBonusValue = parseInt(data.bonusRoll) || 0;
            dice.innerText = activeBonusValue > 0 ? activeBonusValue : "?";
            updateUI(data);
        } catch (err) {
            console.error("Error rolling bonus dice:", err);
            dice.innerText = "?";
        }
        isRolling = false;
    }, 500);
}

// Simulates Villainess dynamic D20 curse rolling sequence
function rollCurseDice() {
    if (isRolling || userRole !== "villainess") return;
    isRolling = true;
    const vDice = document.getElementById('vDiceElement');
    if (!vDice) return;
    vDice.classList.add('rolling');
    let intervals = setInterval(() => { vDice.innerText = Math.floor(Math.random() * 20) + 1; }, 60);
    setTimeout(async () => {
        clearInterval(intervals); vDice.classList.remove('rolling');
        let rolledCurse = Math.floor(Math.random() * 20) + 1;
        vDice.innerText = rolledCurse; isRolling = false;
        try {
            let response = await fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "setCurse", curse: rolledCurse }) });
            let data = await response.json(); updateUI(data);
        } catch (err) { console.error("Error setting curse value:", err); vDice.innerText = "d20"; }
    }, 600);
}

async function fetchGameState() {
    try {
        let response = await fetch(API_URL);
        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) return;
        let data = await response.json();
        updateUI(data);
    } catch (err) { console.error("Error fetching state:", err); }
}

async function spinWheels() {
    let pick1 = categories1[Math.floor(Math.random() * categories1.length)];
    let pick2 = categories2[Math.floor(Math.random() * categories2.length)];
    document.getElementById('spin1Val').innerText = "Spinning...";
    document.getElementById('spin2Val').innerText = "Spinning...";
    let response = await fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "updateSpinners", spinner1: pick1, spinner2: pick2 }) });
    let data = await response.json(); updateUI(data);
}

// BUG FIX #4: no longer computes/sends a combined total. The server derives
// the verified final score itself from the base input plus its own stored
// bonus roll (B13), so the client can't smuggle in an inflated bonus value.
async function submitScore() {
    if (isRolling) return alert("Wait for the dice to finish rolling!");
    // NEW: guard against submitting while a Block/Attack card is unrolled
    // (the button is already disabled for this, but this covers a stray
    // click that lands in the gap before the next poll updates the UI).
    if (lastKnownData && isDiceRollPending(lastKnownData)) {
        return alert("Resolve the active Block/Attack dice roll before submitting your score!");
    }
    let baseScore = parseInt(document.getElementById('scoreInput').value);
    if (isNaN(baseScore) || baseScore <= 0) return alert("Enter a valid damage number");
    document.getElementById('scoreInput').value = ""; 
    let response = await fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "submitScore", baseInputScore: baseScore }) });
    let data = await response.json();
    activeBonusValue = 0;
    updateUI(data);
}

async function activateCard(cardId, effectType, value, name, desc) {
    // UX: mark this exact card as "in flight" and force an immediate re-render
    // so the player sees a "Deploying..." state right away.
    pendingCardId = cardId;
    if (lastKnownData) updateUI(lastKnownData);

    // GENERIC FIX: playCard on the server now creates a dice ticket for ANY
    // effectType matching ACTION_D<number> — including HEAL_D10 — so the old
    // special-cased branch that manually bootstrapped a HEAL_D10 ticket here
    // is no longer needed. Every card, dice or not, just plays the same way.
    try {
        let response = await fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "playCard", cardId: cardId, effectType: effectType }) });
        let data = await response.json();
        pendingCardId = null;
        updateUI(data);
        if (effectType === "SETSCORE" && document.getElementById('scoreInput')) {
            document.getElementById('scoreInput').value = value;
        }
    } catch (err) {
        console.error("Card activation tracking connection fault:", err);
        pendingCardId = null;
        if (lastKnownData) updateUI(lastKnownData);
    }
}

// API Call: Reset spreadsheet
async function confirmReset() {
    let verify = confirm("Are you sure you want to completely reset the game? This will wipe out all categories and round data.");
    if (!verify) return;

    let response = await fetch(API_URL, {
        method: "POST",
        body: JSON.stringify({ action: "resetGame" })
    });
    let data = await response.json();
    updateUI(data);
}

// Controls Modal view display bounds toggles
function toggleHistoryModal(show) {
    const modal = document.getElementById('historyModal');
    if (modal) modal.style.display = show ? 'flex' : 'none';
}

// Execute core cycles
checkPlayerRole();
setInterval(fetchGameState, 2000);
fetchGameState();
