const API_URL = "https://script.google.com/macros/s/AKfycbz6vCg6M83zEaMLKjc-SeRzLtHbrGXfwcugtP5pnM5QgYb5U_9GBv1rBM81oB5HKO0M_Q/exec";
const categories1 = ["Domme", "Influencer/Brat", "Adult Star", "Celebrity", "Captions"];
const categories2 = ["Blonde", "Red", "Brunette"];

let lastRoundScore = 0;
let activeBonusValue = 0; 
let isRolling = false;
let userRole = "hero"; 

// BUG FIX #3: track the shared arena state in memory (not just the DOM) so we
// can guard against double-rolls that slip through in the ~2s gap between polls.
let currentArenaCardId = "";
let currentArenaRollValue = 0;

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

    // Check Shared Network Dice Arena String Parameters (Format: cardId|effectType|rollValue|rollerRole)
    let arenaCardId = "", arenaEffectType = "", arenaRollValue = 0, arenaRollerRole = "";
    if (data.diceArenaState) {
        let parts = data.diceArenaState.split("|");
        arenaCardId = parts[0];
        arenaEffectType = parts[1];
        arenaRollValue = parseInt(parts[2]) || 0;
        arenaRollerRole = parts[3];
    }
    // BUG FIX #3: keep the in-memory guard values in sync with the latest
    // server state every time we poll, so rollSharedArenaDice can check
    // against the real state instead of relying on DOM/CSS timing alone.
    currentArenaCardId = arenaCardId;
    currentArenaRollValue = arenaRollValue;

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

            // Inject an interactive shared dice if this card owns the active rolling ticket
            if (card.id === arenaCardId && (card.effectType === "BLOCK_D6" || card.effectType === "ATTACK_D6" || card.effectType === "HEAL_D10")) {
                let maxSides = card.effectType === "HEAL_D10" ? 10 : 6;
                let displayVal = arenaRollValue > 0 ? arenaRollValue : `d${maxSides}`;
                let isMyTurnToRoll = (userRole === arenaRollerRole) && (arenaRollValue === 0) && !isRolling;
                
                let disabledClass = isMyTurnToRoll ? "" : " disabled";
                let dynamicPrompt = arenaRollValue > 0 ? "ROLL CAST" : (userRole === arenaRollerRole ? "YOUR TURN TO ROLL" : "WAITING FOR OPPONENT");

                diceElementHtml = `
                    <div class="arena-dice-wrapper">
                        <div class="arena-dice-prompt">${dynamicPrompt}</div>
                        <div id="arenaDiceEl" class="arena-dice${disabledClass}" onclick="rollSharedArenaDice('${card.id}', '${card.effectType}', ${maxSides}, '${arenaRollerRole}')">
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
            
            // A card is disabled if it's spent, locked by round, if the hero is silenced, OR if the player already played a card this round!
            let isDisabled = card.spent || card.lockedByRound || (userRole === "hero" && isSilenced) || roleHasPlayedThisRound;
            let cardClass = `game-card ${roleClass}` + (isDisabled ? " disabled" : "");
            
            let stampLabel = "";
            if (card.spent) stampLabel = `<div class="card-stamp-locked">SPENT</div>`;
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
        let cellClass = "round-cell";
        let displayDmg = "-";

        if (dmg !== undefined && dmg !== "" && dmg !== null) {
            let parsedDmg = parseInt(dmg);
            if (!isNaN(parsedDmg) && parsedDmg >= 0 && data.scores[i] !== "") {
                cellClass += " filled";
                displayDmg = parsedDmg;
                finalRawBaseScore = parseInt(baseDmg) || 0;
                filledCount++;
            } else if (!nextEmptyFound) {
                cellClass += " active"; nextEmptyFound = true;
            }
        } else if (!nextEmptyFound) {
            cellClass += " active"; nextEmptyFound = true;
        }
        gridHtml += `<div class="${cellClass}"><div class="round-num">Rnd ${i + 1}</div><div class="round-dmg">${displayDmg}</div></div>`;
    }
    document.getElementById('roundGrid').innerHTML = gridHtml;

    // BUG FIX #4: the bonus box visibility/value now reflects the server-owned
    // roll (data.bonusRoll) instead of only a locally-generated number, so a
    // refreshed/second tab or a mid-round poll stays in sync with the sheet.
    const serverBonusRoll = parseInt(data.bonusRoll) || 0;
    if (finalRawBaseScore === 10 && userRole === "hero") {
        document.getElementById('bonusBox').style.display = 'flex';
        if (serverBonusRoll > 0) {
            activeBonusValue = serverBonusRoll;
            document.getElementById('diceElement').innerText = serverBonusRoll;
        }
    } else {
        document.getElementById('bonusBox').style.display = 'none';
        document.getElementById('diceElement').innerText = "?";
        activeBonusValue = 0;
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

// Interactive Shared Arena Multi-Player Rolling Controller Machine
function rollSharedArenaDice(cardId, effectType, maxSides, rollerRole) {
    if (isRolling || userRole !== rollerRole) return;
    // BUG FIX #3: guard against double-rolling a ticket that was already
    // resolved by the other player in the ~2s gap before our next poll
    // refreshes the DOM/CSS disabled state.
    if (cardId !== currentArenaCardId || currentArenaRollValue > 0) return;

    isRolling = true;

    const diceEl = document.getElementById('arenaDiceEl');
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

            // 2. If it's the custom HEAL_D10 card, run its calculation routing function
            if (effectType === "HEAL_D10") {
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
    let baseScore = parseInt(document.getElementById('scoreInput').value);
    if (isNaN(baseScore) || baseScore <= 0) return alert("Enter a valid damage number");
    document.getElementById('scoreInput').value = ""; 
    let response = await fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "submitScore", baseInputScore: baseScore }) });
    let data = await response.json();
    activeBonusValue = 0;
    updateUI(data);
}

async function activateCard(cardId, effectType, value, name, desc) {
    let systemPayload = { action: "playCard", cardId: cardId, effectType: effectType };
    
    // HEAL_D10 card structure initializes the rolling ticket directly inside the arena
    if (effectType === "HEAL_D10") {
        systemPayload.effectType = "HEAL_D10";
        try {
            await fetch(API_URL, { method: "POST", body: JSON.stringify(systemPayload) });
            // Direct state assignment format parameters: cardId|effectType|0|rollerRole
            let initStr = `${cardId}|HEAL_D10|0|hero`;
            let response = await fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "submitLiveDiceArenaRoll", updatedArenaString: initStr }) });
            let data = await response.json();
            updateUI(data);
            return;
        } catch (e) { console.error(e); }
    }

    try {
        let response = await fetch(API_URL, { method: "POST", body: JSON.stringify(systemPayload) });
        let data = await response.json();
        updateUI(data);
        if (effectType === "SETSCORE" && document.getElementById('scoreInput')) {
            document.getElementById('scoreInput').value = value;
        }
    } catch (err) { console.error("Card activation tracking connection fault:", err); }
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
