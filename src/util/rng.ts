/** 재현 가능한 난수 (mulberry32 — MFC 시뮬레이터 src/util/rng.ts 와 같은 방식). 같은 seed 면 같은 결과. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
  int(min: number, maxInclusive: number): number {
    return Math.floor(this.range(min, maxInclusive + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)] as T;
  }
  /** 지수분포 (포아송 도착 간격). */
  exp(mean: number): number {
    return -Math.log(1 - this.next()) * mean;
  }
}

/** 식별자·Idempotency-Key 발급. 같은 시작값이면 같은 순서(MOCK 재현용). */
export class IdGen {
  private seq = 0;
  constructor(private readonly salt: string = '') {}
  next(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.salt}${this.seq.toString(36).padStart(5, '0')}`;
  }
}
