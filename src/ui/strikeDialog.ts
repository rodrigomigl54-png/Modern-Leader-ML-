import { t, type TranslationKey } from '../i18n';
import { formatPercent } from '../app/present';
import type { SimContext } from '../sim/economy';
import { provinceSeat } from '../sim/military';
import type { GameState } from '../sim/newGame';
import {
  defenseEstimate,
  launchDrones,
  launchSiteFor,
  nuclearBasesOf,
  weaponsRules,
} from '../sim/weapons';
import { button, el } from './dom';

export interface StrikeDialogOptions {
  parent: HTMLElement;
  sim: SimContext;
  provinceName: (provinceId: number) => string;
  cityName: (cityId: number) => string;
  countryName: (countryId: string) => string;
  formatCount: (n: number) => string;
  onMissiles: (targetCityId: number, tier: number, count: number) => void;
  onDrones: (targetProvinceId: number, tier: number, count: number) => void;
  /** Asks again (GDD: confirm before nuclear use), then launches. */
  onNuclear: (targetCityId: number) => void;
}

type Weapon = 'missile' | 'drone' | 'nuclear';

/** Missile, drone or nuclear strike on an enemy province (GDD section 9). */
export class StrikeDialog {
  private readonly backdrop = el('div', 'modal-backdrop');
  private weapon: Weapon = 'missile';
  private tier = 0;
  private count = 5;

  constructor(private readonly options: StrikeDialogOptions) {
    this.backdrop.hidden = true;
    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) this.close();
    });
    options.parent.append(this.backdrop);
  }

  open(game: GameState, provinceId: number): void {
    this.weapon = 'missile';
    this.tier = 0;
    this.render(game, provinceId);
    this.backdrop.hidden = false;
  }

  close(): void {
    this.backdrop.hidden = true;
  }

  private render(game: GameState, provinceId: number): void {
    const { sim } = this.options;
    const rules = weaponsRules(sim);
    const id = game.player.countryId;
    const arsenal = game.weapons.countries[id]!;
    const targetCity = provinceSeat(sim, provinceId);
    const owner = game.world.provinceOwners[provinceId]!;
    const redraw = (): void => this.render(game, provinceId);

    const dialog = el('div', 'modal modal-wide');
    dialog.setAttribute('role', 'dialog');
    dialog.append(
      el('h2', 'modal-title', t('strike.title', { place: this.options.provinceName(provinceId) })),
      el(
        'p',
        'modal-text',
        `${this.options.cityName(targetCity)} · ${this.options.countryName(owner)}`,
      ),
    );
    const defense = defenseEstimate(game, sim, owner, targetCity);
    dialog.append(
      el(
        'p',
        defense.capacity > 0 ? 'setup-warning' : 'setup-hint',
        defense.capacity > 0
          ? t('strike.defended', {
              share: formatPercent(defense.intercept, 0),
              count: defense.capacity,
            })
          : t('strike.undefended'),
      ),
    );

    const nuclear = arsenal.warheads > 0 && nuclearBasesOf(game, sim, id).length > 0;
    const weapons: Weapon[] = nuclear ? ['missile', 'drone', 'nuclear'] : ['missile', 'drone'];
    const tabs = el('div', 'segmented');
    for (const w of weapons) {
      const b = button(`segment${w === this.weapon ? ' segment-on' : ''}`, t(`strike.${w}`), () => {
        this.weapon = w;
        this.tier = 0;
        redraw();
      });
      b.setAttribute('aria-pressed', String(w === this.weapon));
      tabs.append(b);
    }
    dialog.append(tabs);

    const footer = el('div', 'modal-footer');
    const actions = el('div', 'modal-actions');
    actions.append(button('btn btn-secondary', t('saves.cancel'), () => this.close()));

    if (this.weapon === 'nuclear') {
      dialog.append(
        el('p', 'modal-text', t('strike.nuclearStock', { count: arsenal.warheads })),
        el('p', 'setup-warning', t('strike.nuclearWarning')),
      );
      actions.append(
        button('btn btn-danger', t('strike.nuclearLaunch'), () => {
          this.close();
          this.options.onNuclear(targetCity);
        }),
      );
    } else {
      const missiles = this.weapon === 'missile';
      const tiers = missiles ? rules.missiles : rules.drones;
      const stock = missiles ? arsenal.missiles : arsenal.drones;
      const list = el('div', 'option-list');
      const usable: number[] = [];
      tiers.forEach((_, i) => {
        const have = stock[i] ?? 0;
        const inRange = missiles
          ? launchSiteFor(game, sim, id, targetCity, rules.missiles[i]!.rangeKm) >= 0
          : have > 0 && launchDrones(structuredClone(game), sim, id, provinceId, i + 1, 1) === null;
        const ok = have > 0 && inRange;
        if (ok) usable.push(i + 1);
        const range = missiles
          ? t('strike.rangeKm', { km: this.options.formatCount(rules.missiles[i]!.rangeKm) })
          : t('strike.rangeProvinces', { count: rules.drones[i]!.rangeProvinces });
        const option = button(`option${this.tier === i + 1 ? ' option-selected' : ''}`, '', () => {
          this.tier = i + 1;
          this.count = Math.min(Math.max(1, this.count), have);
          redraw();
        });
        option.disabled = !ok;
        option.append(
          el(
            'span',
            'option-title',
            t(
              (missiles
                ? `strike.missileTier${i + 1}`
                : `strike.droneTier${i + 1}`) as TranslationKey,
            ),
          ),
          el(
            'span',
            'option-hint',
            `${range} · ${t('strike.stock', { count: this.options.formatCount(have) })}${
              have > 0 && !inRange ? ` · ${t('strike.outOfRange')}` : ''
            }`,
          ),
        );
        list.append(option);
      });
      if (!usable.includes(this.tier)) this.tier = usable[0] ?? 0;
      dialog.append(list);
      if (this.tier > 0) {
        const have = stock[this.tier - 1] ?? 0;
        this.count = Math.min(Math.max(1, this.count), have);
        const input = el('input', 'input recruit-amount');
        input.type = 'number';
        input.inputMode = 'numeric';
        input.min = '1';
        input.max = String(have);
        input.value = String(this.count);
        input.addEventListener('change', () => {
          this.count = Math.min(have, Math.max(1, Math.floor(Number(input.value) || 1)));
          redraw();
        });
        const row = el('label', 'recruit-row');
        row.append(el('span', '', t('strike.count')), input);
        dialog.append(row);
        if (defense.capacity > 0 && this.count <= defense.capacity)
          footer.append(el('p', 'setup-hint', t('strike.volumeHint', { count: defense.capacity })));
        const tier = this.tier;
        const count = this.count;
        actions.append(
          button('btn btn-danger', t('strike.launch', { count }), () => {
            this.close();
            if (missiles) this.options.onMissiles(targetCity, tier, count);
            else this.options.onDrones(provinceId, tier, count);
          }),
        );
      } else {
        footer.append(el('p', 'setup-warning', t('strike.nothing')));
      }
    }
    footer.append(actions);
    dialog.append(footer);
    this.backdrop.replaceChildren(dialog);
  }
}
