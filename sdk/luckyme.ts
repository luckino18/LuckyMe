/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/luckyme.json`.
 */
export type Luckyme = {
  "address": "4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3",
  "metadata": {
    "name": "luckyme",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "LuckyMe fixed-entry Solana luck pools"
  },
  "instructions": [
    {
      "name": "buyTickets",
      "discriminator": [
        48,
        16,
        122,
        137,
        24,
        214,
        198,
        58
      ],
      "accounts": [
        {
          "name": "player",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "pool"
          ]
        },
        {
          "name": "pool",
          "relations": [
            "round"
          ]
        },
        {
          "name": "round",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  117,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              },
              {
                "kind": "account",
                "path": "pool.currentRound",
                "account": "pool"
              }
            ]
          }
        },
        {
          "name": "entry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  116,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "round"
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        },
        {
          "name": "poolVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "ticketCount",
          "type": "u64"
        },
        {
          "name": "expectedTotalTickets",
          "type": "u64"
        }
      ]
    },
    {
      "name": "closeEmptyRoundAfterTimeout",
      "discriminator": [
        234,
        155,
        116,
        12,
        103,
        105,
        47,
        99
      ],
      "accounts": [
        {
          "name": "keeper",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "keeperConfig",
            "pool"
          ]
        },
        {
          "name": "keeperConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  107,
                  101,
                  101,
                  112,
                  101,
                  114,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "pool",
          "relations": [
            "round"
          ]
        },
        {
          "name": "round",
          "writable": true
        },
        {
          "name": "treasury",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "closeSettledEntry",
      "discriminator": [
        100,
        118,
        42,
        166,
        120,
        168,
        228,
        75
      ],
      "accounts": [
        {
          "name": "keeper",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "keeperConfig"
          ]
        },
        {
          "name": "keeperConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  107,
                  101,
                  101,
                  112,
                  101,
                  114,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "player",
          "writable": true
        },
        {
          "name": "round",
          "writable": true
        },
        {
          "name": "entry",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "closeSettledRandomness",
      "discriminator": [
        175,
        121,
        103,
        176,
        113,
        82,
        206,
        91
      ],
      "accounts": [
        {
          "name": "keeper",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "keeperConfig"
          ]
        },
        {
          "name": "keeperConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  107,
                  101,
                  101,
                  112,
                  101,
                  114,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "round"
        },
        {
          "name": "roundRandomness",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  117,
                  110,
                  100,
                  95,
                  114,
                  97,
                  110,
                  100,
                  111,
                  109,
                  110,
                  101,
                  115,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "round"
              }
            ]
          }
        },
        {
          "name": "treasury",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "closeSettledRound",
      "discriminator": [
        46,
        186,
        140,
        247,
        236,
        83,
        31,
        132
      ],
      "accounts": [
        {
          "name": "keeper",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "keeperConfig",
            "pool"
          ]
        },
        {
          "name": "keeperConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  107,
                  101,
                  101,
                  112,
                  101,
                  114,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "pool",
          "relations": [
            "round"
          ]
        },
        {
          "name": "round",
          "writable": true
        },
        {
          "name": "roundRandomness",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  117,
                  110,
                  100,
                  95,
                  114,
                  97,
                  110,
                  100,
                  111,
                  109,
                  110,
                  101,
                  115,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "round"
              }
            ]
          }
        },
        {
          "name": "treasury",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "initializeConfig",
      "discriminator": [
        208,
        127,
        21,
        1,
        194,
        190,
        196,
        70
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "treasury",
          "type": "pubkey"
        },
        {
          "name": "houseFeeBps",
          "type": "u16"
        },
        {
          "name": "jackpotBps",
          "type": "u16"
        },
        {
          "name": "jackpotOddsDenominator",
          "type": "u32"
        },
        {
          "name": "roundDurationSecs",
          "type": "i64"
        }
      ]
    },
    {
      "name": "initializeKeeperConfig",
      "discriminator": [
        71,
        180,
        50,
        101,
        122,
        212,
        92,
        249
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "keeperConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  107,
                  101,
                  101,
                  112,
                  101,
                  114,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "keeper",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "initializePool",
      "discriminator": [
        95,
        180,
        10,
        172,
        84,
        174,
        232,
        40
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true
        },
        {
          "name": "poolVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "jackpotVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  97,
                  99,
                  107,
                  112,
                  111,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "poolId",
          "type": "u8"
        },
        {
          "name": "ticketPriceLamports",
          "type": "u64"
        }
      ]
    },
    {
      "name": "openRound",
      "discriminator": [
        66,
        235,
        123,
        240,
        8,
        35,
        185,
        159
      ],
      "accounts": [
        {
          "name": "keeper",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "keeperConfig",
            "pool"
          ]
        },
        {
          "name": "keeperConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  107,
                  101,
                  101,
                  112,
                  101,
                  114,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true
        },
        {
          "name": "previousRound",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  117,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              },
              {
                "kind": "account",
                "path": "pool.currentRound",
                "account": "pool"
              }
            ]
          }
        },
        {
          "name": "round",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "randomnessCommitment",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "refundEntryAfterTimeout",
      "discriminator": [
        172,
        253,
        138,
        92,
        31,
        211,
        240,
        150
      ],
      "accounts": [
        {
          "name": "keeper",
          "writable": true,
          "signer": true
        },
        {
          "name": "player",
          "writable": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "keeperConfig",
            "pool"
          ]
        },
        {
          "name": "keeperConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  107,
                  101,
                  101,
                  112,
                  101,
                  114,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "pool",
          "relations": [
            "round"
          ]
        },
        {
          "name": "round",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  117,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              },
              {
                "kind": "account",
                "path": "round.roundId",
                "account": "round"
              }
            ]
          }
        },
        {
          "name": "entry",
          "writable": true
        },
        {
          "name": "poolVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "requestRandomness",
      "discriminator": [
        213,
        5,
        173,
        166,
        37,
        236,
        31,
        18
      ],
      "accounts": [
        {
          "name": "keeper",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "keeperConfig",
            "pool"
          ]
        },
        {
          "name": "keeperConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  107,
                  101,
                  101,
                  112,
                  101,
                  114,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "pool",
          "relations": [
            "round"
          ]
        },
        {
          "name": "round",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  117,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              },
              {
                "kind": "account",
                "path": "pool.currentRound",
                "account": "pool"
              }
            ]
          }
        },
        {
          "name": "roundRandomness",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  117,
                  110,
                  100,
                  95,
                  114,
                  97,
                  110,
                  100,
                  111,
                  109,
                  110,
                  101,
                  115,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "round"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "setKeeper",
      "discriminator": [
        102,
        94,
        23,
        78,
        157,
        222,
        243,
        214
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "keeperConfig"
          ]
        },
        {
          "name": "keeperConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  107,
                  101,
                  101,
                  112,
                  101,
                  114,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "config"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "keeper",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "setPaused",
      "discriminator": [
        91,
        60,
        125,
        192,
        176,
        225,
        166,
        218
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "settleRoundWithProviderRandomness",
      "discriminator": [
        130,
        50,
        207,
        102,
        181,
        238,
        233,
        234
      ],
      "accounts": [
        {
          "name": "keeper",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "keeperConfig",
            "pool"
          ]
        },
        {
          "name": "keeperConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  107,
                  101,
                  101,
                  112,
                  101,
                  114,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "relations": [
            "round"
          ]
        },
        {
          "name": "round",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  117,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              },
              {
                "kind": "account",
                "path": "pool.currentRound",
                "account": "pool"
              }
            ]
          }
        },
        {
          "name": "roundRandomness",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  117,
                  110,
                  100,
                  95,
                  114,
                  97,
                  110,
                  100,
                  111,
                  109,
                  110,
                  101,
                  115,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "round"
              }
            ]
          }
        },
        {
          "name": "providerRandomness"
        },
        {
          "name": "poolVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "jackpotVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  97,
                  99,
                  107,
                  112,
                  111,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "winner",
          "writable": true
        },
        {
          "name": "winnerEntry"
        },
        {
          "name": "jackpotWinner",
          "writable": true
        },
        {
          "name": "jackpotEntry"
        },
        {
          "name": "treasury",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "entry",
      "discriminator": [
        63,
        18,
        152,
        113,
        215,
        246,
        221,
        250
      ]
    },
    {
      "name": "keeperConfig",
      "discriminator": [
        77,
        240,
        250,
        22,
        132,
        135,
        162,
        101
      ]
    },
    {
      "name": "pool",
      "discriminator": [
        241,
        154,
        109,
        4,
        17,
        177,
        109,
        188
      ]
    },
    {
      "name": "round",
      "discriminator": [
        87,
        127,
        165,
        51,
        73,
        78,
        116,
        174
      ]
    },
    {
      "name": "roundRandomness",
      "discriminator": [
        118,
        25,
        18,
        215,
        142,
        125,
        246,
        13
      ]
    }
  ],
  "events": [
    {
      "name": "configInitialized",
      "discriminator": [
        181,
        49,
        200,
        156,
        19,
        167,
        178,
        91
      ]
    },
    {
      "name": "emptyRoundClosed",
      "discriminator": [
        152,
        13,
        45,
        105,
        245,
        8,
        151,
        214
      ]
    },
    {
      "name": "entryRefunded",
      "discriminator": [
        34,
        82,
        130,
        116,
        93,
        139,
        188,
        234
      ]
    },
    {
      "name": "keeperConfigured",
      "discriminator": [
        217,
        232,
        128,
        155,
        254,
        60,
        11,
        47
      ]
    },
    {
      "name": "pausedSet",
      "discriminator": [
        171,
        125,
        127,
        156,
        233,
        81,
        68,
        66
      ]
    },
    {
      "name": "poolInitialized",
      "discriminator": [
        100,
        118,
        173,
        87,
        12,
        198,
        254,
        229
      ]
    },
    {
      "name": "randomnessFulfilled",
      "discriminator": [
        61,
        67,
        128,
        142,
        15,
        77,
        223,
        252
      ]
    },
    {
      "name": "randomnessRequested",
      "discriminator": [
        10,
        64,
        183,
        29,
        104,
        63,
        90,
        149
      ]
    },
    {
      "name": "roundCancelledBelowMinimum",
      "discriminator": [
        47,
        128,
        156,
        64,
        234,
        138,
        148,
        188
      ]
    },
    {
      "name": "roundOpened",
      "discriminator": [
        99,
        173,
        228,
        72,
        142,
        57,
        109,
        178
      ]
    },
    {
      "name": "roundSettled",
      "discriminator": [
        249,
        225,
        66,
        54,
        157,
        200,
        234,
        222
      ]
    },
    {
      "name": "roundStarted",
      "discriminator": [
        180,
        209,
        2,
        244,
        238,
        48,
        170,
        120
      ]
    },
    {
      "name": "settledEntryClosed",
      "discriminator": [
        18,
        210,
        160,
        82,
        230,
        67,
        129,
        96
      ]
    },
    {
      "name": "settledRoundClosed",
      "discriminator": [
        228,
        179,
        22,
        110,
        5,
        169,
        169,
        147
      ]
    },
    {
      "name": "ticketsBought",
      "discriminator": [
        204,
        103,
        221,
        60,
        70,
        142,
        88,
        233
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "feeTooHigh",
      "msg": "Fee is too high"
    },
    {
      "code": 6001,
      "name": "jackpotFeeTooHigh",
      "msg": "Jackpot fee is too high"
    },
    {
      "code": 6002,
      "name": "invalidFeeConfig",
      "msg": "Invalid fee configuration"
    },
    {
      "code": 6003,
      "name": "invalidOdds",
      "msg": "Invalid jackpot odds"
    },
    {
      "code": 6004,
      "name": "invalidRoundDuration",
      "msg": "Invalid round duration"
    },
    {
      "code": 6005,
      "name": "invalidTicketPrice",
      "msg": "Invalid ticket price"
    },
    {
      "code": 6006,
      "name": "invalidPool",
      "msg": "Invalid pool"
    },
    {
      "code": 6007,
      "name": "invalidTicketCount",
      "msg": "Invalid ticket count"
    },
    {
      "code": 6008,
      "name": "invalidWinnerConfig",
      "msg": "Invalid winner configuration"
    },
    {
      "code": 6009,
      "name": "invalidPrizeSplit",
      "msg": "Invalid prize split"
    },
    {
      "code": 6010,
      "name": "notEnoughEntrants",
      "msg": "Not enough entrants for this pool winner count"
    },
    {
      "code": 6011,
      "name": "missingWinnerAccounts",
      "msg": "Missing premium winner accounts"
    },
    {
      "code": 6012,
      "name": "duplicateWinner",
      "msg": "Duplicate winner"
    },
    {
      "code": 6013,
      "name": "invalidWinnerAccount",
      "msg": "Invalid winner account"
    },
    {
      "code": 6014,
      "name": "paused",
      "msg": "Program is paused"
    },
    {
      "code": 6015,
      "name": "invalidKeeper",
      "msg": "Keeper address is invalid"
    },
    {
      "code": 6016,
      "name": "unauthorizedKeeper",
      "msg": "Signer is not the configured keeper"
    },
    {
      "code": 6017,
      "name": "previousRoundStillExists",
      "msg": "Previous round account still exists"
    },
    {
      "code": 6018,
      "name": "commitRevealDisabled",
      "msg": "Commit-reveal settlement is disabled in production"
    },
    {
      "code": 6019,
      "name": "roundClosed",
      "msg": "Round is closed"
    },
    {
      "code": 6020,
      "name": "roundNotStarted",
      "msg": "Round has not started yet"
    },
    {
      "code": 6021,
      "name": "invalidRoundState",
      "msg": "Round state is invalid"
    },
    {
      "code": 6022,
      "name": "roundStillOpen",
      "msg": "Round is still open"
    },
    {
      "code": 6023,
      "name": "roundSettled",
      "msg": "Round is already settled"
    },
    {
      "code": 6024,
      "name": "emptyRound",
      "msg": "Round has no tickets"
    },
    {
      "code": 6025,
      "name": "minimumTicketsNotReached",
      "msg": "Minimum tickets for a valid draw were not reached"
    },
    {
      "code": 6026,
      "name": "minimumDistinctEntrantsNotReached",
      "msg": "Minimum distinct entrants for a valid draw were not reached"
    },
    {
      "code": 6027,
      "name": "roundEligibleForDraw",
      "msg": "Round reached the minimum and must use the draw path"
    },
    {
      "code": 6028,
      "name": "invalidRandomnessCommitment",
      "msg": "Invalid randomness commitment"
    },
    {
      "code": 6029,
      "name": "invalidRandomnessReveal",
      "msg": "Invalid randomness reveal"
    },
    {
      "code": 6030,
      "name": "wrongWinnerEntry",
      "msg": "Wrong winner entry was provided"
    },
    {
      "code": 6031,
      "name": "wrongJackpotEntry",
      "msg": "Wrong jackpot entry was provided"
    },
    {
      "code": 6032,
      "name": "winnerMismatch",
      "msg": "Winner account does not match entry"
    },
    {
      "code": 6033,
      "name": "insufficientVaultFunds",
      "msg": "Vault does not have enough lamports"
    },
    {
      "code": 6034,
      "name": "mathOverflow",
      "msg": "Math overflow"
    },
    {
      "code": 6035,
      "name": "alreadyEnteredRound",
      "msg": "Wallet already entered this round"
    },
    {
      "code": 6036,
      "name": "refundNotAvailable",
      "msg": "Refund is not available yet"
    },
    {
      "code": 6037,
      "name": "nothingToRefund",
      "msg": "Entry has nothing to refund"
    },
    {
      "code": 6038,
      "name": "nothingToClose",
      "msg": "Account has nothing to close"
    },
    {
      "code": 6039,
      "name": "roundHasEntries",
      "msg": "Round already has entries"
    },
    {
      "code": 6040,
      "name": "randomnessAccountStillExists",
      "msg": "Round randomness account still exists"
    },
    {
      "code": 6041,
      "name": "invalidRandomnessProvider",
      "msg": "Invalid randomness provider"
    },
    {
      "code": 6042,
      "name": "invalidRandomnessStatus",
      "msg": "Invalid randomness status"
    },
    {
      "code": 6043,
      "name": "invalidRandomnessProviderAccount",
      "msg": "Invalid randomness provider account"
    },
    {
      "code": 6044,
      "name": "randomnessNotFulfilled",
      "msg": "Provider randomness is not fulfilled"
    },
    {
      "code": 6045,
      "name": "refundsPending",
      "msg": "All refundable entries must be paid before cleanup"
    },
    {
      "code": 6046,
      "name": "reviewedRoundChanged",
      "msg": "Round ticket state changed after review; refresh and review again"
    }
  ],
  "types": [
    {
      "name": "config",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "houseFeeBps",
            "type": "u16"
          },
          {
            "name": "jackpotBps",
            "type": "u16"
          },
          {
            "name": "jackpotOddsDenominator",
            "type": "u32"
          },
          {
            "name": "roundDurationSecs",
            "type": "i64"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "configInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "houseFeeBps",
            "type": "u16"
          },
          {
            "name": "jackpotBps",
            "type": "u16"
          },
          {
            "name": "jackpotOddsDenominator",
            "type": "u32"
          },
          {
            "name": "roundDurationSecs",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "emptyRoundClosed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "round",
            "type": "pubkey"
          },
          {
            "name": "roundId",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "entry",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "round",
            "type": "pubkey"
          },
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "ticketStart",
            "type": "u64"
          },
          {
            "name": "ticketCount",
            "type": "u64"
          },
          {
            "name": "lamports",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "entryRefunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "round",
            "type": "pubkey"
          },
          {
            "name": "entry",
            "type": "pubkey"
          },
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "refundLamports",
            "type": "u64"
          },
          {
            "name": "refundTickets",
            "type": "u64"
          },
          {
            "name": "roundTotalTickets",
            "type": "u64"
          },
          {
            "name": "roundTotalLamports",
            "type": "u64"
          },
          {
            "name": "remainingEntrantCount",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "keeperConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "keeper",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "keeperConfigured",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "keeperConfig",
            "type": "pubkey"
          },
          {
            "name": "previousKeeper",
            "type": "pubkey"
          },
          {
            "name": "keeper",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "pausedSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "paused",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "pool",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "poolId",
            "type": "u8"
          },
          {
            "name": "ticketPriceLamports",
            "type": "u64"
          },
          {
            "name": "currentRound",
            "type": "u64"
          },
          {
            "name": "jackpotLamports",
            "type": "u64"
          },
          {
            "name": "winnerCount",
            "type": "u8"
          },
          {
            "name": "prizeSplitBps",
            "type": {
              "array": [
                "u16",
                3
              ]
            }
          },
          {
            "name": "maxTicketsPerEntry",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          },
          {
            "name": "jackpotBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "poolInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "poolId",
            "type": "u8"
          },
          {
            "name": "ticketPriceLamports",
            "type": "u64"
          },
          {
            "name": "poolVault",
            "type": "pubkey"
          },
          {
            "name": "jackpotVault",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "randomnessFulfilled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "round",
            "type": "pubkey"
          },
          {
            "name": "roundId",
            "type": "u64"
          },
          {
            "name": "provider",
            "type": {
              "defined": {
                "name": "randomnessProvider"
              }
            }
          },
          {
            "name": "request",
            "type": "pubkey"
          },
          {
            "name": "seed",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "client",
            "type": "pubkey"
          },
          {
            "name": "randomnessHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "randomnessProvider",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "commitRevealDemo"
          },
          {
            "name": "oraoVrf"
          },
          {
            "name": "futureProvider"
          }
        ]
      }
    },
    {
      "name": "randomnessRequested",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "round",
            "type": "pubkey"
          },
          {
            "name": "roundId",
            "type": "u64"
          },
          {
            "name": "provider",
            "type": {
              "defined": {
                "name": "randomnessProvider"
              }
            }
          },
          {
            "name": "request",
            "type": "pubkey"
          },
          {
            "name": "seed",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "randomnessStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "notRequested"
          },
          {
            "name": "requested"
          },
          {
            "name": "fulfilled"
          },
          {
            "name": "settled"
          },
          {
            "name": "refundMode"
          }
        ]
      }
    },
    {
      "name": "round",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "roundId",
            "type": "u64"
          },
          {
            "name": "startTs",
            "type": "i64"
          },
          {
            "name": "endTs",
            "type": "i64"
          },
          {
            "name": "ticketPriceLamports",
            "type": "u64"
          },
          {
            "name": "totalTickets",
            "type": "u64"
          },
          {
            "name": "totalLamports",
            "type": "u64"
          },
          {
            "name": "entrantCount",
            "type": "u32"
          },
          {
            "name": "settled",
            "type": "bool"
          },
          {
            "name": "jackpotTriggered",
            "type": "bool"
          },
          {
            "name": "winnerCount",
            "type": "u8"
          },
          {
            "name": "winner",
            "type": "pubkey"
          },
          {
            "name": "winnerSecond",
            "type": "pubkey"
          },
          {
            "name": "winnerThird",
            "type": "pubkey"
          },
          {
            "name": "jackpotWinner",
            "type": "pubkey"
          },
          {
            "name": "randomnessCommitment",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "randomness",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "roundCancelledBelowMinimum",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "round",
            "type": "pubkey"
          },
          {
            "name": "roundId",
            "type": "u64"
          },
          {
            "name": "totalTickets",
            "type": "u64"
          },
          {
            "name": "totalLamports",
            "type": "u64"
          },
          {
            "name": "entrantCount",
            "type": "u32"
          },
          {
            "name": "minimumTickets",
            "type": "u64"
          },
          {
            "name": "minimumDistinctEntrants",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "roundOpened",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "round",
            "type": "pubkey"
          },
          {
            "name": "roundId",
            "type": "u64"
          },
          {
            "name": "startTs",
            "type": "i64"
          },
          {
            "name": "endTs",
            "type": "i64"
          },
          {
            "name": "ticketPriceLamports",
            "type": "u64"
          },
          {
            "name": "randomnessCommitment",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "roundRandomness",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "round",
            "type": "pubkey"
          },
          {
            "name": "provider",
            "type": {
              "defined": {
                "name": "randomnessProvider"
              }
            }
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "randomnessStatus"
              }
            }
          },
          {
            "name": "request",
            "type": "pubkey"
          },
          {
            "name": "randomnessSeed",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "randomnessValue",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "randomnessRequestedAt",
            "type": "i64"
          },
          {
            "name": "randomnessFulfilledAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "roundSettled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "round",
            "type": "pubkey"
          },
          {
            "name": "roundId",
            "type": "u64"
          },
          {
            "name": "winnerCount",
            "type": "u8"
          },
          {
            "name": "winner",
            "type": "pubkey"
          },
          {
            "name": "winnerEntry",
            "type": "pubkey"
          },
          {
            "name": "winnerSecond",
            "type": "pubkey"
          },
          {
            "name": "winnerSecondEntry",
            "type": "pubkey"
          },
          {
            "name": "winnerThird",
            "type": "pubkey"
          },
          {
            "name": "winnerThirdEntry",
            "type": "pubkey"
          },
          {
            "name": "winningTicket",
            "type": "u64"
          },
          {
            "name": "winnerSecondTicket",
            "type": "u64"
          },
          {
            "name": "winnerThirdTicket",
            "type": "u64"
          },
          {
            "name": "mainPrizeLamports",
            "type": "u64"
          },
          {
            "name": "firstPrizeLamports",
            "type": "u64"
          },
          {
            "name": "secondPrizeLamports",
            "type": "u64"
          },
          {
            "name": "thirdPrizeLamports",
            "type": "u64"
          },
          {
            "name": "houseFeeLamports",
            "type": "u64"
          },
          {
            "name": "jackpotAddLamports",
            "type": "u64"
          },
          {
            "name": "jackpotTriggered",
            "type": "bool"
          },
          {
            "name": "jackpotWinner",
            "type": "pubkey"
          },
          {
            "name": "jackpotEntry",
            "type": "pubkey"
          },
          {
            "name": "jackpotTicket",
            "type": "u64"
          },
          {
            "name": "randomness",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "randomnessProvider",
            "type": {
              "defined": {
                "name": "randomnessProvider"
              }
            }
          }
        ]
      }
    },
    {
      "name": "roundStarted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "round",
            "type": "pubkey"
          },
          {
            "name": "roundId",
            "type": "u64"
          },
          {
            "name": "firstPlayer",
            "type": "pubkey"
          },
          {
            "name": "startTs",
            "type": "i64"
          },
          {
            "name": "endTs",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "settledEntryClosed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "round",
            "type": "pubkey"
          },
          {
            "name": "entry",
            "type": "pubkey"
          },
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "rentRecipient",
            "type": "pubkey"
          },
          {
            "name": "remainingEntrantCount",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "settledRoundClosed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "round",
            "type": "pubkey"
          },
          {
            "name": "roundId",
            "type": "u64"
          },
          {
            "name": "rentRecipient",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "ticketsBought",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "round",
            "type": "pubkey"
          },
          {
            "name": "entry",
            "type": "pubkey"
          },
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "ticketStart",
            "type": "u64"
          },
          {
            "name": "ticketCount",
            "type": "u64"
          },
          {
            "name": "entryTicketCount",
            "type": "u64"
          },
          {
            "name": "amountLamports",
            "type": "u64"
          },
          {
            "name": "roundTotalTickets",
            "type": "u64"
          },
          {
            "name": "roundTotalLamports",
            "type": "u64"
          }
        ]
      }
    }
  ]
};
