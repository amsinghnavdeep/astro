"""Generate a photorealistic avatar from a text prompt (open-source Stable
Diffusion, Realistic Vision). Runs on CPU (slow, ~3 min/image) or GPU.

Use as a module:
    from gen_avatar import generate
    path = generate("head and shoulders portrait of ...", out="avatars/x.png")

Or standalone:
    python3 src/gen_avatar.py --prompt "..." --out avatars/new.png --seed 12
"""
import argparse
import os
import time

DEFAULT_PROMPT = (
    "RAW photo, head and shoulders portrait of a 45 year old Indian Hindu "
    "priest pandit, kind wise face, neatly groomed salt-and-pepper beard, "
    "saffron orange silk kurta, multiple rudraksha bead malas, clean plain "
    "forehead, sitting in a warm softly lit indoor studio, looking straight "
    "at camera, calm confident expression, photorealistic, ultra detailed "
    "skin texture, natural lighting, 85mm portrait, sharp focus, 8k")

DEFAULT_NEGATIVE = (
    "cartoon, anime, cgi, 3d render, illustration, painting, drawing, "
    "deformed, disfigured, extra fingers, mutated hands, blurry, low quality, "
    "jpeg artifacts, watermark, text, logo, plastic skin, doll, mask, over "
    "saturated, tilak, forehead mark, bindi, tika, painted forehead, "
    "red dot on forehead")

MODEL = "SG161222/Realistic_Vision_V5.1_noVAE"

_pipe = None


def _get_pipe(gpu=False):
    global _pipe
    if _pipe is not None:
        return _pipe
    import torch
    from diffusers import (StableDiffusionPipeline,
                           DPMSolverMultistepScheduler, AutoencoderKL)
    device = "cuda" if (gpu and torch.cuda.is_available()) else "cpu"
    if device == "cpu":
        os.environ["CUDA_VISIBLE_DEVICES"] = "-1"
        torch.set_num_threads(max(1, (os.cpu_count() or 2)))
    dtype = torch.float16 if device == "cuda" else torch.float32
    vae = AutoencoderKL.from_pretrained("stabilityai/sd-vae-ft-mse",
                                        torch_dtype=dtype)
    pipe = StableDiffusionPipeline.from_pretrained(
        MODEL, vae=vae, torch_dtype=dtype, safety_checker=None)
    pipe.scheduler = DPMSolverMultistepScheduler.from_config(
        pipe.scheduler.config, algorithm_type="dpmsolver++",
        final_sigmas_type="sigma_min")
    _pipe = pipe.to(device)
    return _pipe


def generate(prompt=DEFAULT_PROMPT, out="avatars/generated.png", seed=12,
             negative=DEFAULT_NEGATIVE, steps=22, guidance=6.0,
             width=512, height=768, gpu=False):
    """Generate one avatar image and save it to `out`. Returns the path."""
    import torch
    pipe = _get_pipe(gpu=gpu)
    device = "cuda" if (gpu and torch.cuda.is_available()) else "cpu"
    g = torch.Generator(device).manual_seed(seed)
    t = time.time()
    img = pipe(prompt, negative_prompt=negative, num_inference_steps=steps,
               guidance_scale=guidance, width=width, height=height,
               generator=g).images[0]
    os.makedirs(os.path.dirname(os.path.abspath(out)) or ".", exist_ok=True)
    img.save(out)
    print(f"[gen_avatar] saved {out} in {time.time()-t:.1f}s", flush=True)
    return out


def main():
    ap = argparse.ArgumentParser(description="Generate a photorealistic avatar.")
    ap.add_argument("--prompt", default=DEFAULT_PROMPT)
    ap.add_argument("--negative", default=DEFAULT_NEGATIVE)
    ap.add_argument("--out", default="avatars/generated.png")
    ap.add_argument("--seed", type=int, default=12)
    ap.add_argument("--steps", type=int, default=22)
    ap.add_argument("--guidance", type=float, default=6.0)
    ap.add_argument("--width", type=int, default=512)
    ap.add_argument("--height", type=int, default=768)
    ap.add_argument("--gpu", action="store_true", help="Use CUDA if available.")
    args = ap.parse_args()
    generate(args.prompt, args.out, args.seed, args.negative, args.steps,
             args.guidance, args.width, args.height, args.gpu)


if __name__ == "__main__":
    main()
