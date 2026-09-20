# Vitality Reserve

For GURPS Fourth Edition and GGA. Rules reference: **Pyramid #3/75, p. 20**.

## Set up your reserve

Click **VR** in the character-sheet header. Alternatively, select one token and type **/vr**. With no token selected, the command uses your assigned character. If you have selected an unlinked token, its reserve belongs to that token, not the original actor in the directory.

Choose an existing tracker or create **Vitality Reserve**. The module suggests a maximum when it finds one unambiguous advantage with a level, such as “Vitality Reserve 5” or “Vitality Reserve (5)”. It does not infer the level from character-point cost. Review both **Maximum VR** and **Current VR**, then save. Later changes to the advantage do not silently resize or refill the tracker; reopen setup to update it.

Reopening setup preserves current points. A change to maximum VR does not refill spent points. Trackers are identified by a marker that survives ordinary slot reordering; importing a character sheet may replace trackers, in which case link the tracker again.

## Take damage

Use GGA's normal **Apply Damage Dialogue**, including the dialogue opened by GURPS Manual Damage. GGA calculates injury normally. The VR panel previews how much goes to VR and HP. Each hit uses the remaining reserve, and additional applications continue from the updated pools.

For example, **HP 10/12, VR 5/5** taking **8 injury** becomes **HP 7/12, VR 0/5**. Only the 3 HP injury contributes to shock and other injury consequences. VR does not absorb physical knockback.

**Bypass VR** sends all injury to HP. For a direct HP cost or already-calculated injury, `/vr` also offers **Apply injury / HP expenditure**. That control does not calculate DR or produce hit-location effects.

The ADD shows the ordinary injury calculation, followed by **VR absorbed** and **HP injury**. The final application field shows the split, such as **2 HP + 4 VR**. Its effects advice is adjusted for VR. Chat records the resulting split. A retained dialogue shows the effects of applying another hit with the points currently remaining; it is not a history of the hit just applied.

## Heal

Open **VR**, choose **Heal**, enter the healing amount, and apply it. The GM selects one of these world settings:

| Policy                    | Result                                               |
| ------------------------- | ---------------------------------------------------- |
| HP first, then VR         | Fill missing HP, then restore VR with the remainder. |
| VR first, then HP         | Fill missing VR, then restore HP with the remainder. |
| Healing cannot restore VR | Restore HP only; excess healing is unused.           |

Healing never exceeds either maximum. **HP only** bypasses VR for that action. The healing amount is the final number of points to restore, after any applicable rules or spell calculation.

With **HP 7/12, VR 0/5**, 7 healing gives **HP 12/12, VR 2/5** under HP-first healing, or **HP 9/12, VR 5/5** under VR-first healing.

Use this module's healing control for these policies. Other modules' healing buttons and GGA `/hp` commands do not automatically use them. In particular, Casting Assistant currently heals HP through its own workflow; do not apply its healing and then apply the same healing again here.

## Natural recovery and spending

VR's stated natural recovery is **1 point per day on a successful HT roll, regardless of conditions**. Resolve the HT roll normally, then choose **Recover VR only**, amount **1**. This works even when external healing cannot restore VR. The module does not advance campaign time, enforce daily recovery limits, or roll that HT check for you.

**Spend VR only** handles deliberate VR expenditure and refuses to spend more than remains. **Apply injury / HP expenditure** instead spills excess expenditure into HP.

## GM choices

The default crippling assessment counts only injury that reaches HP. **Original GGA crippling assessment** retains the original crippling advice even when VR absorbs the injury. The Pyramid paragraph does not explicitly settle crippling, so choose the interpretation used in your campaign. VR loss still does not itself produce shock or knockdown.

The **Enable Vitality Reserve** setting disables routing without deleting trackers. **Unlink** in the VR window disables automation for one actor and keeps its tracker and points.

## Corrections and simultaneous actions

Editing HP or a tracker directly remains a manual correction. The module does not turn every HP edit into damage or healing. If an operation reports that HP or VR changed, review the new values and apply the intended action again. If a request times out, inspect its chat receipt and the pools before repeating it.

With an active GM, one GM processes module requests and checks the request author's permissions. Without an active GM, an owner can operate locally; avoid simultaneous edits to the same character from different clients. Updates from unrelated modules are not part of the VR request queue.
